import { useEffect, useState } from 'react';
import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
});

function App() {
  const [donations, setDonations] = useState([]);
  const [form, setForm] = useState({
    title: '',
    description: '',
    location: '',
    contact: '',
  });
  const [message, setMessage] = useState('');
  const [refreshInfo, setRefreshInfo] = useState(null);

  const loadDonations = async () => {
    const response = await api.get('/donations');
    setDonations(response.data);
  };

  useEffect(() => {
    const loadData = async () => {
      try {
        const [donationResponse, healthResponse] = await Promise.all([
          api.get('/donations'),
          api.get('/health'),
        ]);
        setDonations(donationResponse.data);
        setRefreshInfo(healthResponse.data);
      } catch (error) {
        console.error('Failed to load donations', error);
      }
    };

    loadData();
    const interval = window.setInterval(() => {
      loadData();
    }, 15000);

    return () => window.clearInterval(interval);
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    await api.post('/donations', form);
    setForm({ title: '', description: '', location: '', contact: '' });
    setMessage('Donation posted successfully.');
    await loadDonations();
  };

  const handleAccept = async (id) => {
    await api.put(`/donations/${id}/accept`);
    setMessage('Donation accepted by NGO partner.');
    await loadDonations();
  };

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Food Donating App</p>
          <h1>Connect surplus food with NGOs quickly.</h1>
          <p>Donors can share food availability while NGOs can accept and collect donations in real time.</p>
        </div>
      </header>

      <main className="content-grid">
        <section className="panel">
          <h2>Post a donation</h2>
          <form onSubmit={handleSubmit} className="donation-form">
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Food title" required />
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Description" required />
            <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Pickup location" required />
            <input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="Contact number" required />
            <button type="submit">Share donation</button>
          </form>
          {message ? <p className="message">{message}</p> : null}
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>Available donations</h2>
            {refreshInfo ? (
              <p className="refresh-note">Daily reset every 24 hours. Next check: {new Date(refreshInfo.nextRefreshAt).toLocaleString()}</p>
            ) : null}
          </div>
          <div className="donation-list">
            {donations.map((donation) => (
              <article key={donation.id || donation._id} className="donation-card">
                <div className="donation-meta">
                  <span className={`status ${donation.status}`}>{donation.status}</span>
                  <span>{new Date(donation.createdAt).toLocaleDateString()}</span>
                </div>
                <h3>{donation.title}</h3>
                <p>{donation.description}</p>
                <p><strong>Location:</strong> {donation.location}</p>
                <p><strong>Contact:</strong> {donation.contact}</p>
                {donation.acceptedBy ? <p><strong>Accepted by:</strong> {donation.acceptedBy}</p> : null}
                {donation.status !== 'accepted' ? (
                  <button onClick={() => handleAccept(donation.id || donation._id)}>Accept donation</button>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
