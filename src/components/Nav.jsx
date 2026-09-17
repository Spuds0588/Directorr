import { Link } from 'react-router-dom';
import { backendName, isSupabaseConfigured } from '../lib/dataSource.js';

export default function Nav() {
  return (
    <nav className="nav">
      <Link className="brand" to="/">
        Director<span>r</span>
      </Link>
      <span
        className={`badge ${isSupabaseConfigured ? 'supabase' : 'mock'}`}
        data-testid="backend-badge"
        title={
          isSupabaseConfigured
            ? 'Connected to Supabase'
            : 'No Supabase keys configured — running on the local mock backend'
        }
      >
        {backendName === 'supabase' ? 'Supabase' : 'Local mock'}
      </span>
      <div className="nav-links">
        <Link className="navlink" to="/">
          Home
        </Link>
        <Link className="navlink" to="/create" data-testid="nav-create">
          New template
        </Link>
      </div>
    </nav>
  );
}
