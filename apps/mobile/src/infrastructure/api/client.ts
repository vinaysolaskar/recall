const apiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '');

if (!apiUrl) {
    throw new Error('Missing EXPO_PUBLIC_API_URL for the mobile app.');
}

export const apiBaseUrl = apiUrl;