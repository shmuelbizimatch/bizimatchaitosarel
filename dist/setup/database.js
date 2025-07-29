"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupDatabase = setupDatabase;
const supabase_js_1 = require("@supabase/supabase-js");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
// Load environment variables
dotenv_1.default.config();
async function setupDatabase() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
        throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
    }
    console.log('🚀 Setting up Claude Agent System database...');
    const supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseKey);
    try {
        // Read the schema file
        const schemaPath = path_1.default.join(__dirname, '..', 'supabase', 'schema.sql');
        const schema = await fs_1.promises.readFile(schemaPath, 'utf-8');
        console.log('📄 Schema file read successfully');
        // Split the schema into individual statements
        const statements = schema
            .split(';')
            .map(stmt => stmt.trim())
            .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'))
            .map(stmt => stmt + ';');
        console.log(`📝 Found ${statements.length} SQL statements to execute`);
        // Execute each statement
        for (let i = 0; i < statements.length; i++) {
            const statement = statements[i];
            if (statement.trim() === 'COMMIT;')
                continue;
            try {
                const { error } = await supabase.rpc('exec_sql', { sql: statement });
                if (error) {
                    console.log(`⚠️  Statement ${i + 1} had a non-critical error:`, error.message);
                }
                else {
                    console.log(`✅ Statement ${i + 1} executed successfully`);
                }
            }
            catch (error) {
                console.log(`⚠️  Statement ${i + 1} failed (may already exist):`, error.message);
            }
        }
        // Test database connection and table creation
        console.log('🔍 Testing database setup...');
        const { data: projects, error: projectsError } = await supabase
            .from('projects')
            .select('count', { count: 'exact' });
        if (projectsError) {
            throw new Error(`Failed to query projects table: ${projectsError.message}`);
        }
        const { data: tasks, error: tasksError } = await supabase
            .from('tasks')
            .select('count', { count: 'exact' });
        if (tasksError) {
            throw new Error(`Failed to query tasks table: ${tasksError.message}`);
        }
        console.log('✅ Database setup completed successfully!');
        console.log(`📊 Current projects: ${projects?.length || 0}`);
        console.log(`📋 Current tasks: ${tasks?.length || 0}`);
        // Create a test project if none exists
        if (!projects || projects.length === 0) {
            console.log('🆕 Creating test project...');
            const { data: newProject, error: createError } = await supabase
                .from('projects')
                .insert([{
                    name: 'Test Project',
                    settings: {
                        default_ai_engine: 'claude',
                        auto_enhance: false,
                        max_file_size_mb: 10,
                        excluded_patterns: ['node_modules', '.git', 'dist'],
                        preferred_frameworks: ['react', 'typescript']
                    }
                }])
                .select()
                .single();
            if (createError) {
                console.log('⚠️  Failed to create test project:', createError.message);
            }
            else {
                console.log('✅ Test project created:', newProject.id);
            }
        }
        console.log('\n🎉 Database setup complete! You can now run the agent system.');
    }
    catch (error) {
        console.error('❌ Database setup failed:', error);
        process.exit(1);
    }
}
// Run the setup if this file is executed directly
if (require.main === module) {
    setupDatabase()
        .then(() => process.exit(0))
        .catch((error) => {
        console.error('Setup failed:', error);
        process.exit(1);
    });
}
//# sourceMappingURL=database.js.map