import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { MemoryWithCaptures } from '../data/repository';
import type { LocalMemoryRepository } from '../data/localRepository';

type CreateTextMemoryScreenProps = {
    saveText: (text: string) => Promise<MemoryWithCaptures>;
    onCancel: () => void;
    onSaved: (result: MemoryWithCaptures) => void;
    title?: string;
    eyebrow?: string;
    saveLabel?: string;
};

export function CreateTextMemoryScreen({ saveText, onCancel, onSaved, title = 'What do you want to remember?', eyebrow = 'NEW MEMORY', saveLabel = 'Save Memory' }: CreateTextMemoryScreenProps) {
    const insets = useSafeAreaInsets();
    const [text, setText] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    async function save() {
        const normalizedText = text.trim();
        if (!normalizedText) {
            setError('Enter some text before saving.');
            return;
        }
        setSaving(true);
        try {
            const result = await saveText(normalizedText);
            onSaved(result);
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : 'Could not save this Memory locally. Please try again.');
        } finally {
            setSaving(false);
        }
    }

    return (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.safeArea, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <Pressable hitSlop={8} onPress={onCancel} style={styles.backButton}>
                    <Text style={styles.backText}>Back</Text>
                </Pressable>
                <Text style={styles.eyebrow}>{eyebrow}</Text>
                <Text style={styles.title}>{title}</Text>
                <TextInput
                    autoFocus
                    maxLength={10000}
                    multiline
                    onChangeText={(value) => {
                        setText(value);
                        setError('');
                    }}
                    placeholder="Write a moment, note, or thought..."
                    placeholderTextColor="#8a8178"
                    style={styles.textInput}
                    textAlignVertical="top"
                    value={text}
                />
                <View style={styles.editorFooter}>
                    <Text style={styles.counter}>{text.length.toLocaleString()} / 10,000</Text>
                    {error ? <Text style={styles.error}>{error}</Text> : null}
                </View>
                <Pressable disabled={saving} onPress={save} style={styles.primaryButton}>
                    {saving ? <ActivityIndicator color="#fffaf3" /> : <Text style={styles.primaryText}>{saveLabel}</Text>}
                </Pressable>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    safeArea: { backgroundColor: '#f7f4ed', flex: 1 },
    content: { flexGrow: 1, padding: 24 },
    backButton: { alignItems: 'center', alignSelf: 'flex-start', justifyContent: 'center', minHeight: 44, minWidth: 44 },
    backText: { color: '#39735b', fontSize: 15, fontWeight: '600' },
    eyebrow: { color: '#d96c4f', fontSize: 13, fontWeight: '800', letterSpacing: 2, marginTop: 28, marginBottom: 14 },
    title: { color: '#1d2a24', fontSize: 30, fontWeight: '700', lineHeight: 36, marginBottom: 24 },
    textInput: { backgroundColor: '#fffaf3', borderColor: '#d9d0c4', borderRadius: 8, borderWidth: 1, color: '#1d2a24', fontSize: 17, height: 250, lineHeight: 25, marginBottom: 8, padding: 16 },
    editorFooter: { minHeight: 42 },
    counter: { color: '#7a746d', fontSize: 13, marginBottom: 6, textAlign: 'right' },
    error: { color: '#b33a32', fontSize: 14, marginBottom: 12 },
    primaryButton: { alignItems: 'center', backgroundColor: '#d96c4f', borderRadius: 8, justifyContent: 'center', minHeight: 52, padding: 15 },
    primaryText: { color: '#fffaf3', fontSize: 16, fontWeight: '700' },
});