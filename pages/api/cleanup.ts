// pages/api/cleanup.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { promises as fs } from 'fs'
import path from 'path'

// Re-use the same in-memory map
import { roomUploads } from './upload'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const { roomId } = req.body as { roomId: string }
  const uploads = roomUploads[roomId] || []
  await Promise.all(
    uploads.map(fn => fs.unlink(path.join(process.cwd(), 'public', 'uploads', fn)).catch(() => {}))
  )
  delete roomUploads[roomId]
  res.status(200).json({ deleted: uploads.length })
}
