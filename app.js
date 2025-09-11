const express = require('express');
const cors = require('cors');
const multer = require('multer');
const moment = require('moment');
const { GoogleAuth } = require('google-auth-library');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const SLACK_CHANNEL = process.env.SLACK_CHANNEL || 'app-feedbacks';
const SLACK_BOT_NAME = process.env.SLACK_BOT_NAME || 'App Feedbacks Bot';

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

// Serve static files from uploads directory (optional, for debugging)
app.use('/uploads', express.static('uploads'));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

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
        }
    } catch (error) {
        console.error('❌ Error initializing sheet headers:', error);
    }
}

// ✅ NEW: Function to send Slack notification for feedback
async function sendFeedbackSlackNotification(feedbackData) {
  if (!SLACK_WEBHOOK_URL) {
    console.warn('⚠️ SLACK_WEBHOOK_URL is not set. Skipping Slack notification.');
    return;
  }

  const message = {
    username: SLACK_BOT_NAME,
    channel: SLACK_CHANNEL,
    text: "New Feedback Submission",
    attachments: [
      {
        pretext: "A new feedback entry has been submitted to the database.",
        color: "#21C0E8",
        fields: [
          {
            title: "Title",
            value: feedbackData.title,
            short: false
          },
          {
            title: "Description",
            value: feedbackData.description,
            short: false
          },
          {
            title: "User ID",
            value: feedbackData.userId,
            short: true
          },
          {
            title: "Email ID",
            value: feedbackData.emailId,
            short: true
          },
          {
            title: "Photo URLs",
            value: feedbackData.photos || "No photos uploaded.",
            short: false
          },
        ],
      }
    ]
  };

  try {
    await axios.post(SLACK_WEBHOOK_URL, message);
    console.log('✅ Slack notification sent successfully.');
  } catch (error) {
    console.error('❌ Failed to send Slack notification:', error.message);
  }
}

// ========================================
// ROUTES - Health Check & Feedback API
// ========================================

app.get('/health', (req, res) => {
    res.json({ 
        success: true,
        message: 'Feedback API is running!',
        timestamp: new Date().toISOString(),
        port: PORT,
        cloudinary: {
            configured: !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY),
            cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'Not configured'
        },
        availableRoutes: [
            'POST /api/feedback - Submit feedback with photos',
            'GET /api/feedback - Retrieve all feedback',
            'GET /health - Health check'
        ]
    });
});

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
            try {
                for (let i = 0; i < req.files.length; i++) {
                    const file = req.files[i];
                    try {
                        const uploadResult = await uploadToCloudinary(file.buffer, file.originalname);
                        cloudinaryUrls.push(uploadResult.url);
                        photoDetails.push(uploadResult);
                    } catch (fileError) {
                        // Skip failed uploads
                    }
                }
            } catch (cloudinaryError) {
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

        await appendToSheet(feedbackData);

        // ✅ NEW: Call the Slack notification function after successfully saving to the sheet
        await sendFeedbackSlackNotification(feedbackData);

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

        res.json({
            success: true,
            count: data.length,
            data: data
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
});


app.use((error, req, res, next) => {
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
        message: `${req.method} ${req.originalUrl} not found`,
        availableEndpoints: [
            'POST /api/feedback',
            'GET /api/feedback',
            'GET /health'
        ]
    });
});

async function startServer() {
    try {
        await initializeSheetHeaders();
        app.listen(PORT, () => {
            console.log(`Feedback API server running on port ${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
module.exports = app;