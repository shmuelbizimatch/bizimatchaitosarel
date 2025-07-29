import { createClient } from '@supabase/supabase-js';
import { promises as fs } from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function setupDatabase() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
  }

  // Check for placeholder values
  if (supabaseUrl.includes('your-') || supabaseKey.includes('your_')) {
    throw new Error('Please replace placeholder values in .env file with your actual Supabase credentials');
  }

  console.log('🚀 Setting up Claude Agent System database...');
  console.log(`📍 Connecting to: ${supabaseUrl}`);

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // First, test basic connectivity
    console.log('🔍 Testing database connection...');
    const { data: testData, error: testError } = await supabase
      .from('information_schema.tables')
      .select('count', { count: 'exact' })
      .limit(1);
    
    if (testError) {
      throw new Error(`Database connection failed: ${testError.message}\n\nPlease verify:\n- Supabase URL is correct\n- Service role key is valid\n- Project is active`);
    }
    
    console.log('✅ Database connection successful');

    // Read the schema file
    const schemaPath = path.join(__dirname, '..', 'supabase', 'schema.sql');
    const schema = await fs.readFile(schemaPath, 'utf-8');

    console.log('📄 Schema file read successfully');

    // Split the schema into individual statements
    const statements = schema
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'))
      .map(stmt => stmt + ';');

    console.log(`📝 Found ${statements.length} SQL statements to execute`);

    // Execute each statement
    console.log('⚠️  Note: If you see errors about missing functions or tables, that\'s normal for initial setup');
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement.trim() === 'COMMIT;') continue;

      try {
        const { error } = await supabase.rpc('exec_sql', { sql: statement });
        if (error) {
          // Check if it's a "function does not exist" error for exec_sql
          if (error.message.includes('function exec_sql') || error.message.includes('does not exist')) {
            console.log(`⚠️  exec_sql function not available - skipping SQL execution`);
            console.log(`📝 Please run the SQL statements manually in your Supabase SQL editor:`);
            console.log(`   ${supabaseUrl.replace('https://', 'https://supabase.com/dashboard/project/').replace('.supabase.co', '')}/sql`);
            break;
          } else {
            console.log(`⚠️  Statement ${i + 1} had a non-critical error:`, error.message);
          }
        } else {
          console.log(`✅ Statement ${i + 1} executed successfully`);
        }
      } catch (error) {
        console.log(`⚠️  Statement ${i + 1} failed (may already exist):`, (error as Error).message);
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
      } else {
        console.log('✅ Test project created:', newProject.id);
      }
    }

    console.log('\n🎉 Database setup complete! You can now run the agent system.');

  } catch (error) {
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

export { setupDatabase };