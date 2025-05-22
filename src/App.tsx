import { Routes, Route } from 'react-router-dom';
import WODEditor from './components/WODEditor';
import WODDisplay from './components/WODDisplay';
import PastWODs from './components/PastWODs';

function App() {
  return (
    <Routes>
      <Route path="/" element={<WODEditor />} />
      <Route path="/display" element={<WODDisplay />} />
      <Route path="/past" element={<PastWODs />} />
    </Routes>
  );
}

export default App;
