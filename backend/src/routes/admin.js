const express = require('express');
const router = express.Router();

// Import sub-routers
const archiveRoutes = require('./adminArchives');
const settingsRoutes = require('./adminSettings');
const eventsRoutes = require('./adminEvents');
const photosRoutes = require('./adminPhotos');
const categoriesRoutes = require('./adminCategories');
const cmsRoutes = require('./adminCMS');
const notificationsRoutes = require('./adminNotifications');
const backupRoutes = require('./adminBackup');
const restoreRoutes = require('./adminRestore');
const objectStorageRoutes = require('./adminObjectStorage');
const objectDeliveryRoutes = require('./adminObjectDelivery');

// Mount sub-routers
router.use('/archives', archiveRoutes);
router.use('/settings', settingsRoutes);
router.use('/events', eventsRoutes);
router.use('/events', objectDeliveryRoutes);
router.use('/events', photosRoutes);
router.use('/categories', categoriesRoutes);
router.use('/cms', cmsRoutes);
router.use('/notifications', notificationsRoutes);
router.use('/backup', backupRoutes);
router.use('/restore', restoreRoutes);
router.use('/object-storage', objectStorageRoutes);

module.exports = router;
