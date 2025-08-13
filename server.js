const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// In-memory storage for active icons
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

// Routes

// Health check
app.get('/health', (req, res) => {
  console.log('✅ Health check requested');
  res.json({ 
    success: true, 
    message: 'Icon Changer API is running!',
    timestamp: new Date(),
    activeIcons: Object.keys(activeIcons).length,
    availableRoutes: [
      'GET /health',
      'GET /api/app/current-icon',
      'GET /api/admin/icons',
      'POST /api/admin/icons/activate',
      'POST /api/admin/icons/add'
    ]
  });
});

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

// Function to notify all apps
function notifyAllApps(activeIconName) {
  console.log(`📢 Notifying all apps: Active icon changed to ${activeIconName}`);
}

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('💥 Global error:', error);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  console.log(`❌ 404 - Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
    availableRoutes: [
      'GET /health',
      'GET /api/app/current-icon',
      'GET /api/admin/icons',
      'POST /api/admin/icons/activate',
      'POST /api/admin/icons/add'
    ],
    suggestion: 'Check the URL and HTTP method. Available routes are listed above.'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Icon Changer API running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`📁 Available routes:`);
  console.log(`   GET    /health`);
  console.log(`   GET    /api/app/current-icon`);
  console.log(`   GET    /api/admin/icons`);
  console.log(`   POST   /api/admin/icons/activate`);
  console.log(`   POST   /api/admin/icons/add`);
});