import { createSettings } from '../core/settings.js';

export function createSharedState({ initial, persist, onSaved = () => {} }) {
    const settings = createSettings({
        initial,
        persist,
        onChange(value) { state.settings = value; onSaved(); }
    });
    const state = $state({ transcription: {}, settings: settings.value, insight: {busy:false,phase:'idle',result:null} });
    return {
        get settings() { return state.settings; },
        get transcription() { return state.transcription; },
        setTranscription(key, value) { if (value) state.transcription[key] = value; else delete state.transcription[key]; },
        get insight() { return state.insight; },
        setInsight(value) { state.insight = {busy:value.busy,phase:value.phase,result:value.result,snapshot:value.snapshot}; },
        saveSettings: patch => settings.save(patch)
    };
}
