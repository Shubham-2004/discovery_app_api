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

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

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

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

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
        console.error('Make sure:');
        console.error('1. Google Sheets API is enabled in your Google Cloud project');
        console.error('2. The service account has proper permissions');
        console.error('3. The spreadsheet is shared with the service account email');
        throw error;
    }
}

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

        const resource = {
            values,
        };

        const result = await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'Sheet1!A:G', 
            valueInputOption: 'RAW',
            resource,
        });

        console.log('Data successfully added to Google Sheets');
        return result;
    } catch (error) {
        console.error('Error appending to sheet:', error);
        throw error;
    }
}

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
                resource: {
                    values: [headers],
                },
            });
            
            console.log('Sheet headers initialized');
        } else {
            console.log('Sheet headers already exist');
        }
    } catch (error) {
        console.error('Error initializing sheet headers:', error);
    }
}

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Feedback API is running',
        timestamp: new Date().toISOString(),
        cloudinary: {
            configured: !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY),
            cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'Not configured'
        }
    });
});


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

        const now = moment();
        const timestamp = customTimestamp || now.toISOString();
        const date = customDate || now.format('YYYY-MM-DD');


        let cloudinaryUrls = [];
        let photoDetails = [];
        
        if (req.files && req.files.length > 0) {
            console.log(`📸 Uploading ${req.files.length} photos to Cloudinary...`);
            
            try {
                // Upload files one by one to better handle errors
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
                        // Continue with other files instead of failing completely
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
            message: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});


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


app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        message: `${req.method} ${req.originalUrl} not found`
    });
});

console.log('🚀 Starting Feedback API server...');
initializeSheetHeaders().catch(console.error);


app.listen(PORT, () => {});

module.exports = app;