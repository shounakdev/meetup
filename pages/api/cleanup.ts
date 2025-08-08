import type { NextApiRequest, NextApiResponse } from 'next';
import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  let roomId;
  
  if (req.headers['content-type']?.includes('application/json')) {
    roomId = req.body?.roomId;
  } else {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      roomId = body?.roomId;
    } catch (error) {
      return res.status(400).json({ error: 'Invalid request format' });
    }
  }

  if (!roomId) {
    return res.status(400).json({ error: 'Room ID required' });
  }

  try {
    const result = await cloudinary.api.delete_resources_by_tag(`room_${roomId}`);
    const deletedCount = Object.keys(result.deleted || {}).length;
    
    return res.status(200).json({ 
      deleted: deletedCount,
      details: result.deleted || {}
    });
    
  }  catch (error: any) {
  if (error?.message?.includes("Can't find") || error?.http_code === 404) {
    return res.status(200).json({ deleted: 0, message: 'No files to delete' });
  }
  return res.status(500).json({ error: `Cleanup failed: ${error?.message ?? 'Unknown error'}` });
}
}