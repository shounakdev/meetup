import type { NextApiRequest, NextApiResponse } from 'next';
import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    console.log('Testing Cloudinary with config:', {
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY?.substring(0, 4) + '...',
      api_secret: process.env.CLOUDINARY_API_SECRET?.substring(0, 4) + '...'
    });
    
    const result = await cloudinary.api.ping();
    
    res.status(200).json({ 
      success: true, 
      result,
      message: 'Cloudinary connection successful!'
    });
  } catch (error) {
    console.error('Cloudinary error details:', error);
    
    res.status(500).json({ 
      success: false, 
      error: error.message,
      errorCode: error.http_code,
      details: error.error || 'Unknown error'
    });
  }
}