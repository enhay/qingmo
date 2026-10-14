import { createSettings } from '../core/settings.js';

export function createSharedState({ initial, persist, onSaved = () => {} }) {
    const settings = createSettings({
        initial,
        persist,
        onChange(value) { state.settings = value; onSaved(); }
    });
    const state = $state({ settings: settings.value });
    return {
        get settings() { return state.settings; },
        saveSettings: patch => settings.save(patch)
    };
}
