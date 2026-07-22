const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const port = process.env.PORT || 5000;
const DAILY_REFRESH_MS = 24 * 60 * 60 * 1000;
let lastDailyRefresh = new Date();
let mongoServer = null;
let currentDbMode = 'memory';

let fallbackDonations = [
  {
    id: 1,
    title: 'Vegetable surplus from wedding event',
    description: 'Fresh vegetables and packed meals available for pickup tonight.',
    location: 'Koramangala, Bengaluru',
    contact: '9876543210',
    status: 'available',
    createdAt: new Date().toISOString(),
  },
  {
    id: 2,
    title: 'Bakery items',
    description: 'Bread, cakes, and pastries from a local bakery.',
    location: 'Jayanagar, Bengaluru',
    contact: '9988776655',
    status: 'accepted',
    acceptedBy: 'Hope NGO',
    acceptedAt: new Date(Date.now() - DAILY_REFRESH_MS).toISOString(),
    createdAt: new Date().toISOString(),
  },
];

const donationSchema = new mongoose.Schema({
  title: String,
  description: String,
  location: String,
  contact: String,
  status: { type: String, default: 'available' },
  acceptedBy: String,
  createdAt: { type: Date, default: Date.now },
});

const Donation = mongoose.models.Donation || mongoose.model('Donation', donationSchema);

function normalizeMongoUri(uri) {
  if (!uri) {
    return uri;
  }

  return uri.replace(/mongodb:\/\/localhost\b/gi, 'mongodb://127.0.0.1');
}

function serializeDonation(donation) {
  if (!donation) {
    return donation;
  }

  const serialized = { ...donation };
  if (serialized._id) {
    serialized.id = serialized.id || serialized._id.toString();
    delete serialized._id;
  }

  return serialized;
}

async function connectDb() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  try {
    if (process.env.MONGO_URI) {
      const uri = normalizeMongoUri(process.env.MONGO_URI);
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000, family: 4 });
      currentDbMode = 'mongodb';
      return mongoose.connection;
    }

    if (!mongoServer) {
      mongoServer = await MongoMemoryServer.create();
    }

    await mongoose.connect(mongoServer.getUri(), {
      dbName: 'food-donating-app',
      serverSelectionTimeoutMS: 5000,
    });

    currentDbMode = 'mongodb';
    console.log('Connected to local MongoDB instance for development.');
    return mongoose.connection;
  } catch (error) {
    currentDbMode = 'memory';
    console.warn('MongoDB connection failed, using in-memory storage instead:', error.message);
    return null;
  }
}

function refreshDailyDonations(items) {
  const now = new Date();
  const shouldRefresh = now - new Date(lastDailyRefresh) >= DAILY_REFRESH_MS;

  if (!shouldRefresh) {
    return items;
  }

  lastDailyRefresh = now;

  return items.map((item) => {
    if (item.status === 'accepted' && item.acceptedAt) {
      const acceptedAt = new Date(item.acceptedAt);
      if (now - acceptedAt >= DAILY_REFRESH_MS) {
        const refreshedItem = { ...item };
        refreshedItem.status = 'available';
        delete refreshedItem.acceptedBy;
        delete refreshedItem.acceptedAt;
        return refreshedItem;
      }
    }

    return item;
  });
}

async function ensureSeedData() {
  const connection = await connectDb();
  if (!connection) {
    return;
  }

  const count = await Donation.countDocuments();
  if (count > 0) {
    return;
  }

  const sampleDonations = [
    {
      title: 'Vegetable surplus from wedding event',
      description: 'Fresh vegetables and packed meals available for pickup tonight.',
      location: 'Koramangala, Bengaluru',
      contact: '9876543210',
      status: 'available',
      createdAt: new Date(),
    },
    {
      title: 'Bakery items',
      description: 'Bread, cakes, and pastries from a local bakery.',
      location: 'Jayanagar, Bengaluru',
      contact: '9988776655',
      status: 'accepted',
      acceptedBy: 'Hope NGO',
      acceptedAt: new Date(Date.now() - DAILY_REFRESH_MS),
      createdAt: new Date(),
    },
  ];

  await Donation.create(sampleDonations);
}

async function listDonations() {
  const connection = await connectDb();
  if (connection) {
    await ensureSeedData();
    const donations = await Donation.find().sort({ createdAt: -1 }).lean();
    return donations.map(serializeDonation);
  }

  const refreshed = refreshDailyDonations(fallbackDonations);
  if (refreshed !== fallbackDonations) {
    fallbackDonations = refreshed;
  }

  return fallbackDonations.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function createDonation(payload) {
  const connection = await connectDb();
  if (connection) {
    const donation = await Donation.create(payload);
    return serializeDonation(donation.toObject ? donation.toObject() : donation);
  }

  const donation = {
    id: Date.now(),
    ...payload,
    status: 'available',
    createdAt: new Date().toISOString(),
  };
  fallbackDonations.unshift(donation);
  return donation;
}

async function acceptDonation(id) {
  const connection = await connectDb();
  if (connection) {
    const doc = await Donation.findByIdAndUpdate(
      id,
      { status: 'accepted', acceptedBy: 'NGO Partner', acceptedAt: new Date() },
      { new: true },
    );
    return serializeDonation(doc ? (doc.toObject ? doc.toObject() : doc) : null);
  }

  const donation = fallbackDonations.find((item) => item.id === Number(id));
  if (!donation) {
    return null;
  }

  donation.status = 'accepted';
  donation.acceptedBy = 'NGO Partner';
  donation.acceptedAt = new Date().toISOString();
  return donation;
}

app.get('/api/health', async (_req, res) => {
  try {
    const donations = await listDonations();
    res.json({
      status: 'ok',
      mode: currentDbMode,
      refreshCycle: 'daily',
      nextRefreshAt: new Date(Date.now() + DAILY_REFRESH_MS).toISOString(),
      donations: donations.length,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/donations', async (_req, res) => {
  try {
    const donations = await listDonations();
    res.json(donations);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/donations', async (req, res) => {
  try {
    const donation = await createDonation(req.body);
    res.status(201).json(donation);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.put('/api/donations/:id/accept', async (req, res) => {
  try {
    const donation = await acceptDonation(req.params.id);
    if (!donation) {
      return res.status(404).json({ message: 'Donation not found' });
    }

    res.json(donation);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/donations/refresh', async (_req, res) => {
  try {
    const donations = await listDonations();
    res.json({ message: 'Refresh check completed', donations });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
