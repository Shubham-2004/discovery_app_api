const fs = require('fs');
const path = require('path');
require('dotenv').config();

console.log('🔍 Checking configuration...\n');

// Check Google Sheet ID
let configValid = true;

if (!process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SHEET_ID.includes('your_')) {
    console.log('❌ GOOGLE_SHEET_ID: Not configured or contains placeholder value');
    console.log('   Current value:', process.env.GOOGLE_SHEET_ID);
    console.log('   Example format: 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
    configValid = false;
} else {
    console.log('✅ GOOGLE_SHEET_ID: Configured');
    console.log('   Sheet ID:', process.env.GOOGLE_SHEET_ID);
}

// Check Cloudinary configuration
console.log('\n🖼️  Cloudinary Configuration:');
const cloudinaryFields = [
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY', 
    'CLOUDINARY_API_SECRET'
];

cloudinaryFields.forEach(field => {
    if (!process.env[field] || process.env[field].includes('your_')) {
        console.log(`❌ ${field}: Not configured or contains placeholder value`);
        configValid = false;
    } else {
        console.log(`✅ ${field}: Configured`);
    }
});

// Check for a.json credentials file
const credentialsPath = path.join(__dirname, 'a.json');
if (fs.existsSync(credentialsPath)) {
    try {
        const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
        if (credentials.client_email && credentials.private_key && credentials.project_id) {
            console.log('✅ a.json: Valid Google Service Account credentials found');
            console.log(`   Service Account: ${credentials.client_email}`);
            console.log(`   Project ID: ${credentials.project_id}`);
        } else {
            console.log('❌ a.json: Invalid credentials format');
            configValid = false;
        }
    } catch (error) {
        console.log('❌ a.json: Invalid JSON format');
        configValid = false;
    }
} else {
    console.log('❌ a.json: Google Service Account credentials file not found');
    configValid = false;
}

// Check uploads directory
if (fs.existsSync('./uploads')) {
    console.log('✅ uploads/: Directory exists');
} else {
    console.log('⚠️  uploads/: Directory does not exist (will be created on first run)');
}

// Check optional configurations
console.log(`\n📋 Optional Configuration:`);
console.log(`   PORT: ${process.env.PORT || '3000 (default)'}`);
console.log(`   MAX_FILE_SIZE: ${process.env.MAX_FILE_SIZE || '10485760 (10MB default)'}`);
console.log(`   ALLOWED_FILE_TYPES: ${process.env.ALLOWED_FILE_TYPES || 'pdf,doc,docx,txt,jpg,jpeg,png (default)'}`);

console.log('\n' + '='.repeat(50));

if (configValid) {
    console.log('✅ Configuration looks good! You can start the server with: npm start');
    console.log('\n📋 Next steps:');
    console.log('1. Make sure you have shared your Google Sheet with the service account email');
    console.log('2. Update GOOGLE_SHEET_ID in .env with your actual Google Sheet ID');
    console.log('3. Configure Cloudinary credentials in .env for image uploads');
} else {
    console.log('❌ Please fix the configuration issues before starting the server.');
    console.log('\nSetup requirements:');
    console.log('1. Create a Google Sheet and copy its ID from the URL');
    console.log('2. The a.json file should contain valid Google Service Account credentials');
    console.log('3. Share your Google Sheet with the service account email from a.json');
    console.log('4. Update GOOGLE_SHEET_ID in the .env file');
    console.log('5. Set up Cloudinary account and add credentials to .env:');
    console.log('   - CLOUDINARY_CLOUD_NAME');
    console.log('   - CLOUDINARY_API_KEY');
    console.log('   - CLOUDINARY_API_SECRET');
    console.log('   Get these from: https://cloudinary.com/console');
}

console.log('\n📖 For detailed setup instructions, see README.md');
