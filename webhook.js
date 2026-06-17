const express = require('express');
const { exec } = require('child_process');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const PORT = 3000; 
const SECRET = 'P0p0k1ttyr4c3r$'; // Choose a secure secret
const REPO_PATH = '/home/brokertricks-app/htdocs/app.brokertricks.com/editor/'; // Path to your git project

// Verification middleware
function verifySignature(req, res, next) {
    const signature = req.headers['x-hub-signature-256'];
    if (!signature) return res.status(401).send('No signature provided');

    const hmac = crypto.createHmac('sha256', SECRET);
    const digest = 'sha256=' + hmac.update(JSON.stringify(req.body)).digest('hex');

    if (signature !== digest) {
        return res.status(403).send('Invalid signature');
    }
    next();
}

app.post('/webhook', verifySignature, (req, res) => {
    // Only pull if changes are on the main branch
    if (req.body.ref === 'refs/heads/main') { 
        console.log('Push detected on main branch. Pulling changes...');
        
        exec(`cd ${REPO_PATH} && git pull origin main`, (err, stdout, stderr) => {
            if (err) {
                console.error(`Error: ${err}`);
                return res.status(500).send('Pull failed');
            }
            console.log(`Stdout: ${stdout}`);
            return res.status(200).send('Pulled successfully');
        });
    } else {
        res.status(200).send('Not the main branch, ignoring.');
    }
});

app.listen(PORT, () => console.log(`Webhook listener running on port ${PORT}`));
