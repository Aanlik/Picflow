const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const logger = require('../utils/logger');

/**
 * Validate uploaded file is complete and not corrupted
 */
async function validateUploadedFile(filePath) {
  try {
    // Check file exists and has size
    const stats = await fs.stat(filePath);
    if (stats.size === 0) {
      const error = new Error('File is empty');
      error.code = 'EMPTY_FILE';
      throw error;
    }
    
    // For image files, verify they can be read by Sharp
    const ext = path.extname(filePath).toLowerCase();
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    
    if (imageExtensions.includes(ext)) {
      // Try to read metadata - this will fail if image is corrupted
      let metadata;
      try {
        metadata = await sharp(filePath, {
          failOn: 'none', // Don't fail on recoverable errors
          limitInputPixels: 268402689 // ~16k x 16k max
        }).metadata();
      } catch (metadataError) {
        // If metadata reading fails, the file is likely incomplete
        const error = new Error(`Invalid image file: ${metadataError.message}`);
        error.code = 'INVALID_IMAGE';
        throw error;
      }
      
      if (!metadata || !metadata.width || !metadata.height) {
        const error = new Error('Invalid image dimensions - file may be incomplete');
        error.code = 'INVALID_IMAGE';
        throw error;
      }
      
      // Check for reasonable dimensions
      if (metadata.width < 10 || metadata.height < 10) {
        const error = new Error('Image dimensions too small');
        error.code = 'IMAGE_TOO_SMALL';
        throw error;
      }
      
      // Additional check: verify we can actually decode a small portion of the image
      try {
        await sharp(filePath, {
          failOn: 'none',
          limitInputPixels: 268402689
        })
          .resize(10, 10) // Try to resize to very small size
          .toBuffer();
      } catch (decodeError) {
        const error = new Error(`Image decode failed - file may be corrupted: ${decodeError.message}`);
        error.code = 'INVALID_IMAGE';
        throw error;
      }
      
      return true;
    }
    
    return true;
  } catch (error) {
    logger.error(`File validation failed for ${filePath}:`, error.message);
    throw error;
  }
}

/**
 * Middleware to validate uploaded files after multer processing
 */
async function validateUploadedFiles(req, res, next) {
  if (!req.files || req.files.length === 0) {
    return next();
  }
  
  const validFiles = [];
  const invalidFiles = [];
  
  // Validate each file
  for (const file of req.files) {
    try {
      await validateUploadedFile(file.path);
      validFiles.push(file);
    } catch (error) {
      logger.warn(`Removing invalid upload ${file.originalname}: ${error.message}`);
      invalidFiles.push({
        filename: file.originalname,
        error: error.message,
        code: error.code || 'INVALID_IMAGE',
      });
      
      // Delete the invalid file
      try {
        await fs.unlink(file.path);
      } catch (unlinkErr) {
        logger.error(`Failed to delete invalid file ${file.path}:`, unlinkErr.message);
      }
    }
  }
  
  // Update req.files to only include valid files
  req.files = validFiles;
  
  // Store invalid files info for response
  if (invalidFiles.length > 0) {
    req.invalidFiles = invalidFiles;
  }
  
  next();
}

module.exports = {
  validateUploadedFile,
  validateUploadedFiles
};
