const express = require('express');
const cors = require('cors');
const app = express()
const port = process.env.PORT || 8000
require('dotenv').config()

app.use(cors())
app.use(express.json())

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');


app.get('/', (req, res) => {
    res.send('Welcome to Ghurni Server!')
})

const uri = process.env.MONGODB_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();
        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("connected!")

        // 👇 add after this
        const db = client.db("ghuri");
        const ticketsCollection = db.collection("tickets");
        const usersCollection = db.collection("users");
        const bookingsCollection = db.collection("bookings");
        const transactionsCollection = db.collection("transactions");
        const sessionCollection = db.collection("session");

        const verifyVendor = (req, res, next) => {
            if (req.user?.role !== 'vendor') return res.status(403).send({ message: 'forbidden' });
            next();
        }

        const verifyUser = (req, res, next) => {
            if (req.user?.role !== 'user') return res.status(403).send({ message: 'forbidden' });
            next();
        }




        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);



app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})