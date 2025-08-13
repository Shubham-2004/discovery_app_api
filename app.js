const express = require('express');
const cors = require('cors');
const multer = require('multer');
const moment = require('moment');
const { GoogleAuth } = require('google-auth-library');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files from uploads directory
app.use('/uploads', express.static('uploads'));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// ========================================
// ICON CHANGER API - In-memory storage
// ========================================
let activeIcons = {
    DEFAULT: {
        name: 'Default',
        url: '/uploads/icons/default.png',
        isActive: true,
        lastUpdated: new Date()
    },
    navratri1: {
        name: 'Navratri 1',
        url: '/uploads/icons/navratri1.png',
        isActive: false,
        lastUpdated: new Date()
    },
    navratri3: {
        name: 'Navratri 3',
        url: '/uploads/icons/navratri3.png',
        isActive: false,
        lastUpdated: new Date()
    }
};

// ========================================
// FEEDBACK API - Multer Configuration
// ========================================
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    const allowedTypes = process.env.ALLOWED_FILE_TYPES?.split(',') || ['jpg', 'jpeg', 'png', 'gif', 'webp'];
    const fileExt = path.extname(file.originalname).toLowerCase().slice(1);
    
    if (allowedTypes.includes(fileExt)) {
        cb(null, true);
    } else {
        cb(new Error(`File type ${fileExt} is not allowed. Allowed types: ${allowedTypes.join(', ')}`), false);
    }
};

const upload = multer({
    storage: storage,
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 // 10MB default
    },
    fileFilter: fileFilter
});

// ========================================
// FEEDBACK API - Google Sheets Configuration
// ========================================
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

// Function to upload images to Cloudinary
async function uploadToCloudinary(buffer, originalname) {
    return new Promise((resolve, reject) => {
        const uploadOptions = {
            resource_type: 'image',
            folder: 'feedback-photos',
            public_id: `feedback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            quality: 'auto',
            fetch_format: 'auto',
            transformation: [
                { width: 1200, height: 1200, crop: 'limit' },
                { quality: 'auto:good' }
            ]
        };

        cloudinary.uploader.upload_stream(
            uploadOptions,
            (error, result) => {
                if (error) {
                    console.error('Cloudinary upload error:', error);
                    reject(error);
                } else {
                    console.log(`✅ Uploaded to Cloudinary: ${result.secure_url}`);
                    resolve({
                        url: result.secure_url,
                        public_id: result.public_id,
                        original_name: originalname,
                        width: result.width,
                        height: result.height,
                        bytes: result.bytes
                    });
                }
            }
        ).end(buffer);
    });
}

// Function to get Google Sheets instance
async function getGoogleSheetsInstance() {
    try {
        const credentialsPath = path.join(__dirname, 'a.json');
        if (!fs.existsSync(credentialsPath)) {
            throw new Error('Google credentials file (a.json) not found');
        }

        const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));

        const auth = new GoogleAuth({
            credentials: credentials,
            scopes: SCOPES,
        });

        const authClient = await auth.getClient();
        const testResponse = await authClient.getAccessToken();
        if (!testResponse.token) {
            throw new Error('Failed to obtain access token');
        }

        const sheets = google.sheets({ version: 'v4', auth: authClient });
        return sheets;
    } catch (error) {
        console.error('Error setting up Google Sheets:', error);
        throw error;
    }
}

// Function to append data to Google Sheets
async function appendToSheet(feedbackData) {
    try {
        const sheets = await getGoogleSheetsInstance();
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;

        const values = [
            [
                feedbackData.title || '',
                feedbackData.description || '',
                feedbackData.photos || '',
                feedbackData.userId || '',
                feedbackData.emailId || '',
                feedbackData.date || '',
                feedbackData.timestamp || ''
            ]
        ];

        const resource = { values };

        const result = await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'Sheet1!A:G',
            valueInputOption: 'RAW',
            resource,
        });

        console.log('✅ Data successfully added to Google Sheets');
        return result;
    } catch (error) {
        console.error('❌ Error appending to sheet:', error);
        throw error;
    }
}

// Function to initialize sheet headers
async function initializeSheetHeaders() {
    try {
        const sheets = await getGoogleSheetsInstance();
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Sheet1!A1:G1',
        });

        if (!response.data.values || response.data.values.length === 0) {
            const headers = [
                'Title',
                'Description',
                'Photos',
                'User ID',
                'Email ID',
                'Date',
                'TimeStamp'
            ];

            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: 'Sheet1!A1:G1',
                valueInputOption: 'RAW',
                resource: { values: [headers] },
            });
            
            console.log('✅ Sheet headers initialized');
        } else {
            console.log('✅ Sheet headers already exist');
        }
    } catch (error) {
        console.error('❌ Error initializing sheet headers:', error);
    }
}

// Function to notify all apps (for icon changes)
function notifyAllApps(activeIconName) {
    console.log(`📢 Notifying all apps: Active icon changed to ${activeIconName}`);
}

// ========================================
// ROUTES - Health Check
// ========================================
app.get('/health', (req, res) => {
    console.log('✅ Health check requested');
    res.json({ 
        success: true,
        message: 'Unified API is running!',
        services: ['Feedback API', 'Icon Changer API'],
        timestamp: new Date().toISOString(),
        port: PORT,
        cloudinary: {
            configured: !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY),
            cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'Not configured'
        },
        activeIcons: Object.keys(activeIcons).length,
        availableRoutes: {
            feedback: [
                'POST /api/feedback - Submit feedback with photos',
                'GET /api/feedback - Retrieve all feedback'
            ],
            iconChanger: [
                'GET /api/app/current-icon - Get current active icon',
                'GET /api/admin/icons - Get all icons',
                'POST /api/admin/icons/activate - Activate an icon',
                'POST /api/admin/icons/add - Add new icon'
            ],
            general: [
                'GET /health - Health check'
            ]
        }
    });
});

// ========================================
// FEEDBACK API ROUTES
// ========================================

// POST endpoint for feedback submission
app.post('/api/feedback', upload.array('photos', 10), async (req, res) => {
    try {
        const {
            title,
            description,
            userId,
            emailId,
            customDate,
            customTimestamp
        } = req.body;

        console.log('📝 Received feedback submission:', {
            title: title?.substring(0, 50) + '...',
            description: description?.substring(0, 50) + '...',
            userId,
            emailId,
            filesCount: req.files ? req.files.length : 0
        });

        // Validation
        if (!title || title.trim() === '') {
            return res.status(400).json({
                success: false,
                error: 'Title is required'
            });
        }

        if (!description || description.trim() === '') {
            return res.status(400).json({
                success: false,
                error: 'Description is required'
            });
        }

        // Get current timestamp
        const now = moment();
        const timestamp = customTimestamp || now.toISOString();
        const date = customDate || now.format('YYYY-MM-DD');

        // Upload photos to Cloudinary
        let cloudinaryUrls = [];
        let photoDetails = [];
        
        if (req.files && req.files.length > 0) {
            console.log(`📸 Uploading ${req.files.length} photos to Cloudinary...`);
            
            try {
                for (let i = 0; i < req.files.length; i++) {
                    const file = req.files[i];
                    console.log(`📤 Uploading file ${i + 1}/${req.files.length}: ${file.originalname}`);
                    
                    try {
                        const uploadResult = await uploadToCloudinary(file.buffer, file.originalname);
                        cloudinaryUrls.push(uploadResult.url);
                        photoDetails.push(uploadResult);
                        console.log(`✅ File ${i + 1} uploaded successfully`);
                    } catch (fileError) {
                        console.error(`❌ Failed to upload file ${file.originalname}:`, fileError);
                    }
                }
                
                console.log(`🎉 Successfully uploaded ${cloudinaryUrls.length}/${req.files.length} photos to Cloudinary`);
                
            } catch (cloudinaryError) {
                console.error('❌ Error uploading to Cloudinary:', cloudinaryError);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to upload photos',
                    message: cloudinaryError.message
                });
            }
        }

        // Prepare feedback data
        const feedbackData = {
            title: title.trim(),
            description: description.trim(),
            photos: cloudinaryUrls.join(', '),
            userId: userId?.trim() || '',
            emailId: emailId?.trim() || '',
            date: date,
            timestamp: timestamp
        };

        console.log('📊 Saving to Google Sheets...');
        await appendToSheet(feedbackData);
        console.log('🎉 Feedback submitted successfully!');

        res.status(201).json({
            success: true,
            message: 'Feedback submitted successfully',
            data: {
                id: timestamp,
                submittedAt: timestamp,
                photosUploaded: cloudinaryUrls.length,
                photosAttempted: req.files ? req.files.length : 0,
                title: feedbackData.title,
                description: feedbackData.description,
                photoUrls: cloudinaryUrls,
                photoDetails: photoDetails
            }
        });

    } catch (error) {
        console.error('❌ Error submitting feedback:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
});

// GET endpoint to retrieve feedback
app.get('/api/feedback', async (req, res) => {
    try {
        console.log('📋 Retrieving feedback data...');
        
        const sheets = await getGoogleSheetsInstance();
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Sheet1!A:G',
        });

        const rows = response.data.values || [];
        const headers = rows[0] || [];
        const data = rows.slice(1).map(row => {
            const feedback = {};
            headers.forEach((header, index) => {
                feedback[header.toLowerCase().replace(/\s+/g, '_')] = row[index] || '';
            });
            return feedback;
        });

        console.log(`📊 Retrieved ${data.length} feedback entries`);

        res.json({
            success: true,
            count: data.length,
            data: data
        });

    } catch (error) {
        console.error('❌ Error retrieving feedback:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
});

// ========================================
// ICON CHANGER API ROUTES
// ========================================

// 📱 App: Get current active icon
app.get('/api/app/current-icon', (req, res) => {
    try {
        console.log('📱 App requesting current icon');
        const activeIcon = Object.keys(activeIcons).find(key => activeIcons[key].isActive);
        
        if (!activeIcon) {
            console.log('❌ No active icon found');
            return res.status(404).json({
                success: false,
                message: 'No active icon found'
            });
        }

        console.log(`✅ Current active icon: ${activeIcon}`);
        res.json({
            success: true,
            data: {
                iconName: activeIcon,
                displayName: activeIcons[activeIcon].name,
                url: `${req.protocol}://${req.get('host')}${activeIcons[activeIcon].url}`,
                lastUpdated: activeIcons[activeIcon].lastUpdated
            }
        });

    } catch (error) {
        console.error('❌ Get current icon error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get current icon',
            error: error.message
        });
    }
});

// 🎯 Admin: Set active icon
app.post('/api/admin/icons/activate', (req, res) => {
    try {
        console.log('🎯 Admin activating icon:', req.body);
        const { iconName } = req.body;

        if (!iconName) {
            console.log('❌ No iconName provided');
            return res.status(400).json({
                success: false,
                message: 'iconName is required'
            });
        }

        if (!activeIcons[iconName]) {
            console.log(`❌ Icon '${iconName}' not found. Available icons:`, Object.keys(activeIcons));
            return res.status(400).json({
                success: false,
                message: `Invalid icon name '${iconName}'. Available icons: ${Object.keys(activeIcons).join(', ')}`
            });
        }

        // Deactivate all icons
        Object.keys(activeIcons).forEach(key => {
            activeIcons[key].isActive = false;
        });

        // Activate selected icon
        activeIcons[iconName].isActive = true;
        activeIcons[iconName].lastUpdated = new Date();

        console.log(`✅ Icon '${iconName}' activated successfully`);
        notifyAllApps(iconName);

        res.json({
            success: true,
            message: `Icon '${activeIcons[iconName].name}' activated successfully`,
            data: {
                activeIcon: iconName,
                displayName: activeIcons[iconName].name,
                url: activeIcons[iconName].url
            }
        });

    } catch (error) {
        console.error('❌ Activation error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to activate icon',
            error: error.message
        });
    }
});

// 📋 Admin: Get all icons
app.get('/api/admin/icons', (req, res) => {
    try {
        console.log('📋 Admin requesting all icons');
        const icons = Object.keys(activeIcons).map(key => ({
            iconName: key,
            displayName: activeIcons[key].name,
            url: `${req.protocol}://${req.get('host')}${activeIcons[key].url}`,
            isActive: activeIcons[key].isActive,
            lastUpdated: activeIcons[key].lastUpdated
        }));

        console.log(`✅ Returning ${icons.length} icons`);
        res.json({
            success: true,
            data: icons
        });

    } catch (error) {
        console.error('❌ Get icons error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get icons',
            error: error.message
        });
    }
});

// 🔐 Admin: Add new icon
app.post('/api/admin/icons/add', (req, res) => {
    try {
        console.log('📤 Admin adding icon:', req.body);
        const { iconName, displayName, iconUrl } = req.body;
        
        if (!iconName || !displayName || !iconUrl) {
            return res.status(400).json({
                success: false,
                message: 'iconName, displayName, and iconUrl are required'
            });
        }

        if (activeIcons[iconName]) {
            return res.status(400).json({
                success: false,
                message: `Icon '${iconName}' already exists`
            });
        }

        // Save icon info
        activeIcons[iconName] = {
            name: displayName,
            url: iconUrl,
            isActive: false,
            lastUpdated: new Date()
        };

        console.log(`✅ Icon '${iconName}' added successfully`);
        res.json({
            success: true,
            message: 'Icon added successfully',
            data: {
                iconName,
                displayName,
                url: iconUrl
            }
        });

    } catch (error) {
        console.error('❌ Add icon error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add icon',
            error: error.message
        });
    }
});

// ========================================
// ERROR HANDLING MIDDLEWARE
// ========================================

app.use((error, req, res, next) => {
    console.error('🚨 Middleware error:', error);
    
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: 'File too large',
                message: `Maximum file size is ${(parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024) / (1024 * 1024)}MB`
            });
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
                success: false,
                error: 'Too many files',
                message: 'Maximum 10 files allowed'
            });
        }
        if (error.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({
                success: false,
                error: 'Unexpected file field',
                message: 'Please use field name "photos" for image uploads'
            });
        }
    }
    
    if (error.message && error.message.includes('File type')) {
        return res.status(400).json({
            success: false,
            error: 'Invalid file type',
            message: error.message
        });
    }
    
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
    });
});

// 404 handler
app.use((req, res) => {
    console.log(`❌ 404 - Route not found: ${req.method} ${req.originalUrl}`);
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        message: `${req.method} ${req.originalUrl} not found`,
        availableEndpoints: {
            feedback: [
                'POST /api/feedback',
                'GET /api/feedback'
            ],
            iconChanger: [
                'GET /api/app/current-icon',
                'GET /api/admin/icons',
                'POST /api/admin/icons/activate',
                'POST /api/admin/icons/add'
            ],
            general: [
                'GET /health'
            ]
        },
        suggestion: 'Check the URL and HTTP method. Available endpoints are listed above.'
    });
});

// ========================================
// SERVER STARTUP
// ========================================

async function startServer() {
    try {
        console.log('🚀 Starting Unified API server...');
        console.log('📦 Services: Feedback API + Icon Changer API');
        
        // Initialize Google Sheets headers for feedback
        await initializeSheetHeaders();
        
        app.listen(PORT, () => {
            console.log(`🎉 Unified API server running on port ${PORT}`);
            console.log(`📊 Health check: http://localhost:${PORT}/health`);
            console.log('');
            console.log('📝 FEEDBACK API ENDPOINTS:');
            console.log(`   POST   http://localhost:${PORT}/api/feedback`);
            console.log(`   GET    http://localhost:${PORT}/api/feedback`);
            console.log('');
            console.log('🎨 ICON CHANGER API ENDPOINTS:');
            console.log(`   GET    http://localhost:${PORT}/api/app/current-icon`);
            console.log(`   GET    http://localhost:${PORT}/api/admin/icons`);
            console.log(`   POST   http://localhost:${PORT}/api/admin/icons/activate`);
            console.log(`   POST   http://localhost:${PORT}/api/admin/icons/add`);
            console.log('');
            console.log('✅ Both APIs are ready to accept requests!');
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

startServer();

module.exports = app;
