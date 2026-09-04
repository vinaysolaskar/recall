import { StyleSheet, Text, View } from 'react-native';

export default function App() {
    return (
        <View style={styles.container}>
            <Text style={styles.title}>Recall</Text>
            <Text style={styles.subtitle}>Mobile app is running.</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        backgroundColor: '#f7f4ed',
        flex: 1,
        justifyContent: 'center',
        padding: 24,
    },
    title: {
        color: '#1d2a24',
        fontSize: 32,
        fontWeight: '700',
        marginBottom: 8,
    },
    subtitle: {
        color: '#52635b',
        fontSize: 16,
    },
});
