import type { NextApiRequest, NextApiResponse } from 'next';
import formidable, { File as FormidableFile } from 'formidable';
import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';

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

  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    return res.status(500).json({ error: 'Cloud storage not configured' });
  }

  const form = formidable({
    maxFileSize: 10 * 1024 * 1024, // 10 MB
  });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      return res.status(500).json({ error: 'File upload failed' });
    }

    let roomId = typeof fields.roomId === 'string' ? fields.roomId : Array.isArray(fields.roomId) ? fields.roomId[0] : undefined;
    if (!roomId) {
      roomId = req.headers['x-room-id'] as string;
    }

    const fileField = files.file as FormidableFile | FormidableFile[];
    const file = Array.isArray(fileField) ? fileField[0] : fileField;

    if (!file?.filepath) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!fs.existsSync(file.filepath)) {
      return res.status(500).json({ error: 'File not found after upload' });
    }

        try {
      const result = await cloudinary.uploader.upload(file.filepath, {
        folder: `video-call-uploads/${roomId || 'default'}`,
        tags: [`room_${roomId || 'default'}`],
        resource_type: 'auto',
        public_id: `${Date.now()}_${file.originalFilename?.replace(/[^a-zA-Z0-9]/g, '_')}`,
      });

      try {
        fs.unlinkSync(file.filepath);
      } catch {

        // Silent cleanup failure - not critical
      }

      return res.status(200).json({ url: result.secure_url });
    } catch (error: unknown) {
      try {
        fs.unlinkSync(file.filepath);
      } catch {

        // Silent cleanup failure
      }

      const msg =
        error instanceof Error ? error.message :
        typeof error === 'string' ? error :
        'Unknown error';

      return res.status(500).json({ error: `Upload to cloud failed: ${msg}` });
    }
  });
}
