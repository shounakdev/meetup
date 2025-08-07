import type { NextApiRequest, NextApiResponse } from 'next';
import formidable, { File as FormidableFile } from 'formidable';
import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const config = {
  api: {
    bodyParser: false,
  },
};

type Data = { url: string } | { error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  // Check if Cloudinary is configured
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    console.error('Missing Cloudinary configuration');
    return res.status(500).json({ error: 'Cloud storage not configured' });
  }

  const form = formidable({
    maxFileSize: 10 * 1024 * 1024, // 10 MB
  });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error('Form parse error:', err);
      return res.status(500).json({ error: 'File upload failed' });
    }

    // Get roomId
    let roomId = typeof fields.roomId === 'string' ? fields.roomId : Array.isArray(fields.roomId) ? fields.roomId[0] : undefined;
    if (!roomId) {
      roomId = req.headers['x-room-id'] as string;
    }

    console.log('Room ID:', roomId);
    console.log('Files received:', Object.keys(files));

    const fileField = files.file as FormidableFile | FormidableFile[];
    const file = Array.isArray(fileField) ? fileField[0] : fileField;

    if (!file?.filepath) {
      console.error('No file found in upload');
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('File info:', {
      filepath: file.filepath,
      originalFilename: file.originalFilename,
      mimetype: file.mimetype,
      size: file.size
    });

    // Check if file exists
    if (!fs.existsSync(file.filepath)) {
      console.error('File does not exist at path:', file.filepath);
      return res.status(500).json({ error: 'File not found after upload' });
    }

    try {
      console.log('Attempting Cloudinary upload...');
      
      // Upload to Cloudinary with room-specific folder and tags
      const result = await cloudinary.uploader.upload(file.filepath, {
        folder: `video-call-uploads/${roomId || 'default'}`,
        tags: [`room_${roomId || 'default'}`],
        resource_type: 'auto', // Handles images, videos, etc.
        public_id: `${Date.now()}_${file.originalFilename?.replace(/[^a-zA-Z0-9]/g, '_')}`,
      });

      console.log('Upload successful:', result.secure_url);

      // Clean up temp file
      try {
        fs.unlinkSync(file.filepath);
      } catch (cleanupError) {
        console.warn('Failed to clean up temp file:', cleanupError);
      }

      return res.status(200).json({ url: result.secure_url });
    } catch (error) {
      console.error('Cloudinary upload error:', error);
      
      // Clean up temp file even on error
      try {
        fs.unlinkSync(file.filepath);
      } catch (cleanupError) {
        console.warn('Failed to clean up temp file after error:', cleanupError);
      }
      
      return res.status(500).json({ 
        error: `Upload to cloud failed: ${error.message}` 
      });
    }
  });
}