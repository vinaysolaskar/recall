import { Router } from 'express';

import { requireAuth, type AuthenticatedUser } from './middleware.js';

export const authRouter = Router();

authRouter.get('/user', requireAuth, (_request, response) => {
    const user = response.locals.user as AuthenticatedUser;

    response.json({
        id: user.id,
        email: user.email,
    });
});