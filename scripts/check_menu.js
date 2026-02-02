const fs = require('fs');
const path = require('path');

// Define the path to the menu schema file
const menuSchemaPath = path.join(__dirname, '../data/menu.schema.json');

try {
    // Read the schema file
    const schemaContent = fs.readFileSync(menuSchemaPath, 'utf8');
    const schema = JSON.parse(schemaContent);

    // Perform basic validation
    console.log('Menu schema validation passed:', schema);
} catch (err) {
    console.error(`Error parsing JSON file ${menuSchemaPath}:`, err.message);
    process.exit(2); // Exit with error code 2
}
