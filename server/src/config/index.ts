import 'dotenv/config';

function getRequiredEnvironmentVariable(name: string): string {
    const value = process.env[name]?.trim();

    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }

    return value;
}

const supabaseUrl = getRequiredEnvironmentVariable('SUPABASE_URL');

try {
    new URL(supabaseUrl);
} catch {
    throw new Error('SUPABASE_URL must be a valid URL');
}

export const config = {
    supabaseUrl,
    supabaseServiceRoleKey: getRequiredEnvironmentVariable('SUPABASE_SERVICE_ROLE_KEY'),
    groqApiKey: getRequiredEnvironmentVariable('GROQ_API_KEY'),
    port: Number(process.env.PORT ?? 3000),
};