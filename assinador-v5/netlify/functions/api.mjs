import { getStore } from '@netlify/blobs';
import { handle } from './lib/core.mjs';

export default async (req) => handle(req, { getStore, env: process.env });

export const config = { path: '/api/*' };
