import { supabase } from './client.js';

try {
    const { error } = await supabase.auth.admin.listUsers({
        page: 1,
        perPage: 1,
    });

    if (error) {
        throw error;
    }

    console.log('Supabase connectivity check passed.');
} catch {
    console.error('Supabase connectivity check failed.');
    process.exitCode = 1;
}