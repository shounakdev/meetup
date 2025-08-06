// pages/api/upload.ts

import type { NextApiRequest, NextApiResponse } from 'next';
import formidable, { File as FormidableFile } from 'formidable';
import fs from 'fs';
import path from 'path';

// Turn off Next’s default body parser so Formidable can handle multipart
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
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  // 1) Ensure upload directory exists under /public
  const uploadDir = path.join(process.cwd(), 'public', 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });

  // 2) Create a Formidable instance (modern API)
  const form = formidable({
    uploadDir,
    keepExtensions: true,
    maxFileSize: 10 * 1024 * 1024, // 10 MB
    filename: (_name, _ext, part) => {
      // e.g. "1691234567890_myphoto.png"
      return `${Date.now()}_${part.originalFilename}`;
    },
  });

  // 3) Parse the incoming form
  form.parse(req, (err, _fields, files) => {
    if (err) {
      console.error('Upload error:', err);
      return res.status(500).json({ error: 'File upload failed' });
    }

    // 4) Grab the file. Formidable gives you File | File[]
    const fileField = files.file as FormidableFile | FormidableFile[];
    const file = Array.isArray(fileField) ? fileField[0] : fileField;

    if (!file?.filepath) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // 5) Build a public URL under /uploads
    const fileName = path.basename(file.filepath);
    const url = `/uploads/${fileName}`;

    return res.status(200).json({ url });
  });
}
