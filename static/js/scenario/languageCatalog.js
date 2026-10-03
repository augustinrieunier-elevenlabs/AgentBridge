/**
 * Single source of truth for the languages this app supports, matching the
 * additional languages activated on the Caller Simulator agent (caller_agent/,
 * spec-agent-appelant.md section 3.1). Used to drive the scenario language
 * picklist (ScenarioEditor.jsx) and the voice table (AudioPanel.jsx), so a
 * scenario's ISO code and its display name can never drift apart -- see the
 * incident on conv_9001m3vvhymrfv8a9f64deh2bx6h where both fields were typed
 * by hand as "es" instead of "es" / "Spanish".
 *
 * 2026-10-01: expanded to the full set of additional languages activated on
 * the agent's dashboard (`conversation_config.language_presets`, 82 entries
 * + the base "en") -- confirmed live via `agents get --query
 * conversation_config.language_presets`. This is the dashboard's own
 * "additional languages" locale list, which is close to but not identical
 * to the 74-language table of the configured TTS model (eleven_v3_conversational,
 * see `elevenlabs models list`): it's missing Cebuano/Chichewa/Lingala and
 * adds 12 others (Asturian, Maori, Mongolian, Maltese, Burmese, Occitan,
 * Odia, Portuguese (Brazil) as a distinct locale, Tajik, Uzbek, Yoruba,
 * Cantonese). Names and codes verified against `elevenlabs models list`
 * (language_id/name) plus standard ISO 639-1/BCP-47 names for the 12 extra.
 */
(function () {
  const LANGUAGE_CATALOG = [
    { code: "af", name: "Afrikaans", defaultStyle: "neutral" },
    { code: "ar", name: "Arabic", defaultStyle: "Modern Standard Arabic" },
    { code: "hy", name: "Armenian", defaultStyle: "neutral" },
    { code: "as", name: "Assamese", defaultStyle: "neutral" },
    { code: "ast", name: "Asturian", defaultStyle: "neutral" },
    { code: "az", name: "Azerbaijani", defaultStyle: "neutral" },
    { code: "be", name: "Belarusian", defaultStyle: "neutral" },
    { code: "bn", name: "Bengali", defaultStyle: "neutral" },
    { code: "bs", name: "Bosnian", defaultStyle: "neutral" },
    { code: "bg", name: "Bulgarian", defaultStyle: "neutral" },
    { code: "my", name: "Burmese", defaultStyle: "neutral" },
    { code: "yue", name: "Cantonese", defaultStyle: "neutral" },
    { code: "ca", name: "Catalan", defaultStyle: "neutral" },
    { code: "hr", name: "Croatian", defaultStyle: "neutral" },
    { code: "cs", name: "Czech", defaultStyle: "neutral" },
    { code: "da", name: "Danish", defaultStyle: "neutral" },
    { code: "nl", name: "Dutch", defaultStyle: "neutral" },
    { code: "en", name: "English", defaultStyle: "neutral" },
    { code: "et", name: "Estonian", defaultStyle: "neutral" },
    { code: "fil", name: "Filipino", defaultStyle: "neutral" },
    { code: "fi", name: "Finnish", defaultStyle: "neutral" },
    { code: "fr", name: "French", defaultStyle: "neutral" },
    { code: "gl", name: "Galician", defaultStyle: "neutral" },
    { code: "ka", name: "Georgian", defaultStyle: "neutral" },
    { code: "de", name: "German", defaultStyle: "neutral" },
    { code: "el", name: "Greek", defaultStyle: "neutral" },
    { code: "gu", name: "Gujarati", defaultStyle: "neutral" },
    { code: "ha", name: "Hausa", defaultStyle: "neutral" },
    { code: "he", name: "Hebrew", defaultStyle: "neutral" },
    { code: "hi", name: "Hindi", defaultStyle: "neutral" },
    { code: "hu", name: "Hungarian", defaultStyle: "neutral" },
    { code: "is", name: "Icelandic", defaultStyle: "neutral" },
    { code: "id", name: "Indonesian", defaultStyle: "neutral" },
    { code: "ga", name: "Irish", defaultStyle: "neutral" },
    { code: "it", name: "Italian", defaultStyle: "neutral" },
    { code: "ja", name: "Japanese", defaultStyle: "polite keigo, natural Tokyo speech" },
    { code: "jv", name: "Javanese", defaultStyle: "neutral" },
    { code: "kn", name: "Kannada", defaultStyle: "neutral" },
    { code: "kk", name: "Kazakh", defaultStyle: "neutral" },
    { code: "ky", name: "Kirghiz", defaultStyle: "neutral" },
    { code: "ko", name: "Korean", defaultStyle: "polite register" },
    { code: "lv", name: "Latvian", defaultStyle: "neutral" },
    { code: "lt", name: "Lithuanian", defaultStyle: "neutral" },
    { code: "lb", name: "Luxembourgish", defaultStyle: "neutral" },
    { code: "mk", name: "Macedonian", defaultStyle: "neutral" },
    { code: "ms", name: "Malay", defaultStyle: "neutral" },
    { code: "ml", name: "Malayalam", defaultStyle: "neutral" },
    { code: "mt", name: "Maltese", defaultStyle: "neutral" },
    { code: "zh", name: "Mandarin Chinese", defaultStyle: "Taiwanese Mandarin, polite register" },
    { code: "mi", name: "Maori", defaultStyle: "neutral" },
    { code: "mr", name: "Marathi", defaultStyle: "neutral" },
    { code: "mn", name: "Mongolian", defaultStyle: "neutral" },
    { code: "ne", name: "Nepali", defaultStyle: "neutral" },
    { code: "no", name: "Norwegian", defaultStyle: "neutral" },
    { code: "oc", name: "Occitan", defaultStyle: "neutral" },
    { code: "or", name: "Odia", defaultStyle: "neutral" },
    { code: "ps", name: "Pashto", defaultStyle: "neutral" },
    { code: "fa", name: "Persian", defaultStyle: "neutral" },
    { code: "pl", name: "Polish", defaultStyle: "neutral" },
    { code: "pt", name: "Portuguese", defaultStyle: "neutral Brazilian Portuguese" },
    { code: "pt-br", name: "Portuguese (Brazil)", defaultStyle: "neutral Brazilian Portuguese" },
    { code: "pa", name: "Punjabi", defaultStyle: "neutral" },
    { code: "ro", name: "Romanian", defaultStyle: "neutral" },
    { code: "ru", name: "Russian", defaultStyle: "neutral" },
    { code: "sr", name: "Serbian", defaultStyle: "neutral" },
    { code: "sd", name: "Sindhi", defaultStyle: "neutral" },
    { code: "sk", name: "Slovak", defaultStyle: "neutral" },
    { code: "sl", name: "Slovenian", defaultStyle: "neutral" },
    { code: "so", name: "Somali", defaultStyle: "neutral" },
    { code: "es", name: "Spanish", defaultStyle: "neutral Latin American Spanish" },
    { code: "sw", name: "Swahili", defaultStyle: "neutral" },
    { code: "sv", name: "Swedish", defaultStyle: "neutral" },
    { code: "tg", name: "Tajik", defaultStyle: "neutral" },
    { code: "ta", name: "Tamil", defaultStyle: "neutral" },
    { code: "te", name: "Telugu", defaultStyle: "neutral" },
    { code: "th", name: "Thai", defaultStyle: "neutral" },
    { code: "tr", name: "Turkish", defaultStyle: "neutral" },
    { code: "uk", name: "Ukrainian", defaultStyle: "neutral" },
    { code: "ur", name: "Urdu", defaultStyle: "neutral" },
    { code: "uz", name: "Uzbek", defaultStyle: "neutral" },
    { code: "vi", name: "Vietnamese", defaultStyle: "neutral" },
    { code: "cy", name: "Welsh", defaultStyle: "neutral" },
    { code: "yo", name: "Yoruba", defaultStyle: "neutral" },
  ];

  function findLanguage(code) {
    return LANGUAGE_CATALOG.find((l) => l.code === code);
  }

  window.AB.scenario.LANGUAGE_CATALOG = LANGUAGE_CATALOG;
  window.AB.scenario.findLanguage = findLanguage;
})();
