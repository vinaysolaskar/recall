import type { NextFunction, Request, Response } from 'express';

import { supabase } from '../../infrastructure/supabase/client.js';

export type AuthenticatedUser = {
    id: string;
    email: string | null;
};

export async function requireAuth(
    request: Request,
    response: Response,
    next: NextFunction,
): Promise<void> {
    const authorization = request.header('authorization');
    const token = authorization?.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length).trim()
        : '';

    if (!token) {
        response.status(401).json({ error: 'Authentication required.' });
        return;
    }

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
        response.status(401).json({ error: 'Authentication required.' });
        return;
    }

    response.locals.user = {
        id: data.user.id,
        email: data.user.email ?? null,
    } satisfies AuthenticatedUser;

    next();
}