/**
 * The 3 example scenarios required by spec-agent-bridge-demo.md section 6.1:
 * hotel receptionist (ja), clinic appointment booking (zh), e-commerce order
 * follow-up (es). These are fictional scenarios only -- no real customer data
 * (spec-agent-bridge-demo.md section 10).
 */
(function () {
  function makeId(name) {
    return `example-${name}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function buildExamplePresets() {
    return [
      {
        id: makeId("hotel-ja"),
        name: "Hotel receptionist (Japanese)",
        language: "ja",
        languageName: "Japanese",
        languageStyle: "polite keigo, natural Tokyo speech",
        personaName: "Kenji Tanaka",
        personaDescription: "45-year-old business traveller, slightly in a hurry, first time in Paris",
        callerMood: "in a hurry",
        verbosity: "short",
        calleeBusiness: "Hôtel Le Marais, Paris",
        context: "You booked a room for next Tuesday and want practical information before arriving.",
        callGoal: "Get answers to all your questions.",
        questions: [
          { text: "A quelle heure est servi le petit-déjeuner ?", language: "ja" },
          { text: "Y a-t-il un parking a proximite ?", language: "ja" },
          { text: "Puis-je arriver apres minuit ?", language: "ja" },
        ],
        personalDetails: "Booking number: 48213. Arrival: Tuesday around 11 pm.",
        behaviors: ["ask_repeat"],
        endGoal: "when all questions are answered, or after 2 failed attempts on the same question",
        maxDurationSec: 180,
        firstSpeaker: "callee",
        asrKeywords: ["Le Marais", "check-in"],
      },
      {
        id: makeId("clinic-zh"),
        name: "Clinic appointment booking (Mandarin)",
        language: "zh",
        languageName: "Mandarin Chinese",
        languageStyle: "Taiwanese Mandarin, polite register",
        personaName: "Li Wei",
        personaDescription: "32-year-old office worker booking a check-up for her father",
        callerMood: "calm",
        verbosity: "natural",
        calleeBusiness: "Clinique Saint-Michel",
        context: "You want to book a general check-up appointment for your father next week.",
        callGoal: "Book an appointment and understand what documents to bring.",
        questions: [
          { text: "Avez-vous un creneau la semaine prochaine ?", language: "zh" },
          { text: "Quels documents dois-je apporter ?", language: "zh" },
          { text: "Combien de temps dure la consultation ?", language: "zh" },
        ],
        personalDetails: "Father's name: Li Ming, age 71. No current medical record at this clinic.",
        behaviors: ["off_topic"],
        endGoal: "when an appointment is booked and the required documents are confirmed",
        maxDurationSec: 180,
        firstSpeaker: "callee",
        asrKeywords: ["rendez-vous", "consultation"],
      },
      {
        id: makeId("ecommerce-es"),
        name: "E-commerce order follow-up (Spanish)",
        language: "es",
        languageName: "Spanish",
        languageStyle: "neutral Latin American Spanish",
        personaName: "Carla Mendoza",
        personaDescription: "28-year-old customer following up on a delayed order",
        callerMood: "annoyed",
        verbosity: "short",
        calleeBusiness: "an online electronics store",
        context: "Your order was supposed to arrive 3 days ago and the tracking page hasn't moved.",
        callGoal: "Get a clear status update and, if possible, a new delivery date.",
        questions: [
          { text: "Pouvez-vous verifier le statut de ma commande ?", language: "es" },
          { text: "Quand va-t-elle etre livree ?", language: "es" },
          // Demonstrates a per-question language switch -- this question is asked in
          // English, replacing the old global "switch_language" behavior (removed
          // 2026-10-01, see dynamicVariables.js).
          { text: "Puis-je obtenir un geste commercial pour le retard ?", language: "en" },
        ],
        personalDetails: "Order number: ECM-88213. Placed 9 days ago.",
        behaviors: [],
        endGoal: "when you have a clear status and a delivery commitment, or after 2 failed attempts",
        maxDurationSec: 180,
        firstSpeaker: "callee",
        asrKeywords: ["order", "tracking", "delivery"],
      },
    ];
  }

  window.AB.scenario.buildExamplePresets = buildExamplePresets;
})();
