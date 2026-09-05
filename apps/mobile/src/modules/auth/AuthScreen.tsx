import { useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';

import { supabase } from '../../infrastructure/supabase/client';

type Mode = 'login' | 'register';

export function AuthenticationScreen() {
    const [mode, setMode] = useState<Mode>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const isRegistering = mode === 'register';

    async function submit() {
        setError('');
        setMessage('');
        const normalizedEmail = email.trim();
        if (!normalizedEmail || !normalizedEmail.includes('@')) {
            setError('Enter a valid email address.');
            return;
        }
        if (password.length < 6) {
            setError('Password must be at least 6 characters.');
            return;
        }
        if (isRegistering && password !== confirmPassword) {
            setError('Passwords do not match.');
            return;
        }

        setSubmitting(true);
        const result = isRegistering
            ? await supabase.auth.signUp({
                email: normalizedEmail,
                password,
            })
            : await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
        setSubmitting(false);

        if (result.error) {
            if (isRegistering) {
                console.error('Supabase signUp failed:', {
                    message: result.error.message,
                    code: result.error.code,
                    status: result.error.status,
                });
                setError(result.error.message);
            } else {
                setError(getAuthError(result.error.message, false));
            }
        } else if (isRegistering && !result.data.session) {
            setMessage('Account created. Check your email to confirm your account, then log in.');
            setMode('login');
            setPassword('');
            setConfirmPassword('');
        }
    }

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.content}>
                <Text style={styles.eyebrow}>RECALL</Text>
                <Text style={styles.title}>{isRegistering ? 'Create your account' : 'Welcome back'}</Text>
                <Text style={styles.subtitle}>{isRegistering ? 'Keep your memories close.' : 'Continue to your memories.'}</Text>
                <TextInput autoCapitalize="none" autoComplete="email" keyboardType="email-address" onChangeText={setEmail} placeholder="Email" placeholderTextColor="#8a8178" style={styles.input} value={email} />
                <TextInput autoCapitalize="none" autoComplete="password" onChangeText={setPassword} placeholder="Password" placeholderTextColor="#8a8178" secureTextEntry style={styles.input} value={password} />
                {isRegistering && <TextInput autoCapitalize="none" onChangeText={setConfirmPassword} placeholder="Confirm password" placeholderTextColor="#8a8178" secureTextEntry style={styles.input} value={confirmPassword} />}
                {error ? <Text style={styles.error}>{error}</Text> : null}
                {message ? <Text style={styles.message}>{message}</Text> : null}
                <Pressable disabled={submitting} onPress={submit} style={styles.primaryButton}>
                    {submitting ? <ActivityIndicator color="#fffaf3" /> : <Text style={styles.primaryText}>{isRegistering ? 'Create account' : 'Log in'}</Text>}
                </Pressable>
                <Pressable onPress={() => { setMode(isRegistering ? 'login' : 'register'); setError(''); setMessage(''); }} style={styles.secondaryButton}>
                    <Text style={styles.secondaryText}>{isRegistering ? 'Already have an account? Log in' : 'Need an account? Register'}</Text>
                </Pressable>
            </View>
        </SafeAreaView>
    );
}

export function AuthenticatedHome({ session }: { session: Session }) {
    const [error, setError] = useState('');

    async function logout() {
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) setError('Could not log out. Please try again.');
    }

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.content}>
                <Text style={styles.eyebrow}>RECALL</Text>
                <Text style={styles.title}>You are signed in</Text>
                <Text style={styles.subtitle}>{session.user.email ?? 'Authenticated user'}</Text>
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <Pressable onPress={logout} style={styles.primaryButton}><Text style={styles.primaryText}>Log out</Text></Pressable>
            </View>
        </SafeAreaView>
    );
}

function getAuthError(message: string, registering: boolean) {
    const normalized = message.toLowerCase();
    if (normalized.includes('already registered') || normalized.includes('already exists')) return 'An account with this email already exists. Try logging in.';
    if (normalized.includes('invalid login credentials')) return 'Incorrect email or password.';
    if (normalized.includes('invalid email')) return 'Enter a valid email address.';
    return registering ? 'Could not create the account. Please try again.' : 'Could not log in. Please try again.';
}

const styles = StyleSheet.create({
    content: { flex: 1, justifyContent: 'center', padding: 28 },
    safeArea: { backgroundColor: '#f7f4ed', flex: 1 },
    eyebrow: { color: '#d96c4f', fontSize: 13, fontWeight: '800', letterSpacing: 2, marginBottom: 16 },
    title: { color: '#1d2a24', fontSize: 32, fontWeight: '700', marginBottom: 8 },
    subtitle: { color: '#52635b', fontSize: 16, marginBottom: 28 },
    input: { backgroundColor: '#fffaf3', borderColor: '#d9d0c4', borderRadius: 8, borderWidth: 1, color: '#1d2a24', fontSize: 16, marginBottom: 12, padding: 15 },
    error: { color: '#b33a32', fontSize: 14, marginBottom: 12 },
    message: { color: '#39735b', fontSize: 14, marginBottom: 12 },
    primaryButton: { alignItems: 'center', backgroundColor: '#d96c4f', borderRadius: 8, justifyContent: 'center', minHeight: 52, padding: 15 },
    primaryText: { color: '#fffaf3', fontSize: 16, fontWeight: '700' },
    secondaryButton: { alignItems: 'center', padding: 18 },
    secondaryText: { color: '#39735b', fontSize: 14, fontWeight: '600' },
});