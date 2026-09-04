import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';

import { config } from '../../config/index.js';

export const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false,
    },
    realtime: {
        transport: WebSocket as unknown as NonNullable<Parameters<typeof createClient>[2]>['realtime'] extends {
            transport?: infer Transport;
        }
            ? Transport
            : never,
    },
});