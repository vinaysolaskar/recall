import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';

import { supabase } from './src/infrastructure/supabase/client';
import { AuthenticatedHome, AuthenticationScreen } from './src/modules/auth/AuthScreen';

export default function App() {
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let mounted = true;

        async function restoreSession() {
            const { data } = await supabase.auth.getSession();
            if (mounted) {
                setSession(data.session);
                setLoading(false);
            }
        }

        restoreSession().catch(() => {
            if (mounted) {
                setLoading(false);
            }
        });

        const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
            setSession(nextSession);
            setLoading(false);
        });

        return () => {
            mounted = false;
            data.subscription.unsubscribe();
        };
    }, []);

    if (loading) {
        return (
            <View style={{ alignItems: 'center', backgroundColor: '#f7f4ed', flex: 1, justifyContent: 'center' }}>
                <ActivityIndicator color="#d96c4f" />
            </View>
        );
    }

    return session ? <AuthenticatedHome session={session} /> : <AuthenticationScreen />;
}
