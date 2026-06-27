const THANZI_CONFIG = {
  endpoint: 'https://fra.cloud.appwrite.io/v1',
  projectId: 'thanzi-app',
  databaseId: 'thanzi-db',
  collections: {
    profiles:      'profiles',
    foodLogs:      'food_logs',
    waterLogs:     'water_logs',
    weightLogs:    'weight_logs',
    customFoods:   'custom_foods',
    mealTemplates: 'meal_templates',
    recipes:       'recipes',
  },
  functions: {
    aiAssistant: 'YOUR_AI_FUNCTION_ID'
  }
};
