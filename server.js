const express = require('express');
const mongoose = require('mongoose');
const morgan = require('morgan'); 
const path = require('path');
const fs = require('fs').promises;

const User = require('./models/User');
const app = express();

app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'views')));
app.use(express.static('public'));

mongoose.connect('mongodb://127.0.0.1:27017/croprotation')
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// Basic routes
    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, 'views', 'home.html'));
    });

    app.get('/register.html', (req, res) => {
        res.sendFile(path.join(__dirname, 'views', 'register.html'));
    });
    
    app.get('/login.html', (req, res) => {
        res.sendFile(path.join(__dirname, 'views', 'login.html'));
    });

    app.get('/road_map.html', (req, res) => {
        res.sendFile(path.join(__dirname, 'views', 'road_map.html'));
    });

    app.get('/forgot-password.html', (req, res) => {
        res.sendFile(path.join(__dirname, 'views', 'forgot-password.html'));
    });

    app.get('/road_map.html', (req, res) => {
        res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
    });
    app.get('/crop-prediction', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'ip.html'));
    });

// User authentication routes
    app.post('/signup-form', async (req, res) => {
        try {
            const existingUser = await User.findOne({ email: req.body.email });
            if (existingUser) {
                return res.status(400).json({ message: 'Email already registered' });
            }
    
            const newUser = new User({
                firstName: req.body.firstName,
                lastName: req.body.lastName,
                email: req.body.email,
            password: req.body.password
            });
    
            await newUser.save();
        res.status(201).json({ 
            message: 'Registration successful',
            redirectUrl: '/login.html'
        });
        } catch (error) {
            console.error('Registration error:', error);
            res.status(500).json({ message: 'Error registering user' });
        }
    });
    
    app.post('/login', async (req, res) => {
        try {
            const { email, password } = req.body;
            const user = await User.findOne({ email });
            
            if (!user) {
                return res.status(400).json({ message: 'User not found' });
            }
    
            if (user.password !== password) {
                return res.status(400).json({ message: 'Invalid password' });
            }
    
            res.json({ 
                message: 'Login successful',
            redirectUrl: '/dashboard.html',
                user: {
                    email: user.email,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    createdAt: user.createdAt
                }
            });
        } catch (error) {
            console.error('Login error:', error);
            res.status(500).json({ message: 'Error logging in' });
        }
    });

// Dataset loading function
async function loadCropDataset() {
    try {
        const data = await fs.readFile(path.join(__dirname, 'views', 'updated_crop_dataset.csv'), 'utf-8');
        const lines = data.trim().split('\n').filter(line => line.length > 0);
        const headers = lines[0].split(',').map(h => h.trim());

        const records = lines.slice(1).map(line => {
            const values = line.split(',').map(val => val.trim());
            const record = {};
            headers.forEach((header, index) => {
                record[header] = values[index];
            });
            return record;
        });

        return records;
    } catch (error) {
        console.error('Error loading dataset:', error);
        throw new Error(`Failed to load dataset: ${error.message}`);
    }
}

// Crop prediction endpoint
app.post('/predict-crop', async (req, res) => {
    try {
        const dataset = await loadCropDataset();
        const matchingRecords = dataset.filter(record => {
            try {
                const nSimilarity = 1 - Math.abs(parseFloat(record.N) - parseFloat(req.body.n)) / 100;
                const pSimilarity = 1 - Math.abs(parseFloat(record.P) - parseFloat(req.body.p)) / 50;
                const kSimilarity = 1 - Math.abs(parseFloat(record.K) - parseFloat(req.body.k)) / 50;
                const tempSimilarity = 1 - Math.abs(parseFloat(record.temperature) - parseFloat(req.body.temperature)) / 20;
                const humiditySimilarity = 1 - Math.abs(parseFloat(record.humidity) - parseFloat(req.body.humidity)) / 50;
                const phSimilarity = 1 - Math.abs(parseFloat(record.ph) - parseFloat(req.body.ph)) / 3;
                const rainfallSimilarity = 1 - Math.abs(parseFloat(record.rainfall) - parseFloat(req.body.rainfall)) / 200;

                const soilMatch = record.soil_type === req.body.soil_type;
                const waterMatch = record.water_requirement === req.body.water_requirement;
                const durationMatch = record.crop_duration === req.body.crop_duration;
                const previousCropMatch = record.previous_crop === req.body.previous_crop;

                const similarityScore = (
                    (nSimilarity * 0.1) +
                    (pSimilarity * 0.1) +
                    (kSimilarity * 0.1) +
                    (tempSimilarity * 0.1) +
                    (humiditySimilarity * 0.1) +
                    (phSimilarity * 0.1) +
                    (rainfallSimilarity * 0.1) +
                    (soilMatch ? 0.1 : 0) +
                    (waterMatch ? 0.1 : 0) +
                    (durationMatch ? 0.1 : 0)
                );

                return similarityScore >= 0.6;
            } catch (error) {
                return false;
            }
        });

        if (matchingRecords.length === 0) {
            return res.json({
                success: false,
                message: 'No suitable crops found for these conditions. Try adjusting some parameters.'
            });
        }

        const cropStats = {};
        matchingRecords.forEach(record => {
            const cropName = record.label;
            if (!cropStats[cropName]) {
                cropStats[cropName] = {
                    count: 0,
                    totalInvestment: 0,
                    totalProfit: 0
                };
            }
            cropStats[cropName].count++;
            cropStats[cropName].totalInvestment += parseFloat(record.investment_per_acre);
            cropStats[cropName].totalProfit += parseFloat(record.predicted_crop_profit_per_acre);
        });

        const recommendations = Object.entries(cropStats)
            .map(([crop, stats]) => ({
                crop,
                averageInvestment: (stats.totalInvestment / stats.count).toFixed(2),
                predictedProfit: (stats.totalProfit / stats.count).toFixed(2),
                sampleCount: stats.count
            }))
            .sort((a, b) => parseFloat(b.predictedProfit) - parseFloat(a.predictedProfit))
            .slice(0, 5);

        res.json({
            success: true,
            recommendations,
            matchCount: matchingRecords.length
        });

    } catch (error) {
        console.error('Prediction error:', error);
        res.json({
            success: false,
            message: 'Error making prediction: ' + error.message
        });
    }
});

// Get previous crops endpoint
app.get('/get-previous-crops', async (req, res) => {
    try {
        const data = await fs.readFile(path.join(__dirname, 'views', 'updated_crop_dataset.csv'), 'utf-8');
        const lines = data.trim().split('\n');
        const headers = lines[0].split(',').map(h => h.trim());
        
        const previousCropIndex = headers.indexOf('previous_crop');
        const labelIndex = headers.indexOf('label');

        const uniqueCrops = new Set();
        lines.slice(1).forEach(line => {
            const values = line.split(',').map(v => v.trim());
            if (values[previousCropIndex]) uniqueCrops.add(values[previousCropIndex]);
            if (values[labelIndex]) uniqueCrops.add(values[labelIndex]);
        });

        const allCrops = Array.from(uniqueCrops).sort();

        res.json({
            success: true,
            crops: allCrops
        });
    } catch (error) {
        console.error('Error getting crops:', error);
        res.json({
            success: false,
            message: 'Error loading crops: ' + error.message
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    });