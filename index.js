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

        // MongoDB Collections
        const db = client.db("ghurni");
        const ticketsCollection = db.collection("tickets");
        const usersCollection = db.collection("user");
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

        // session-based token verification middleware
        const verifyToken = async (req, res, next) => {
            const authHeader = req.headers?.authorization;
            if (!authHeader) return res.status(401).send({ message: 'unauthorized access' });

            const token = authHeader.split(' ')[1];
            if (!token) return res.status(401).send({ message: 'unauthorized access' });

            const session = await sessionCollection.findOne({ token });
            if (!session) return res.status(401).send({ message: 'unauthorized access' });

            const user = await usersCollection.findOne({ _id: session.userId });
            if (!user) return res.status(401).send({ message: 'unauthorized access' });

            req.user = user;
            next();
        }


        // All tickets with search, filter, sort, pagination
        app.get('/api/tickets', async (req, res) => {
            const query = {};
            if (req.query.vendorEmail) query.vendorEmail = req.query.vendorEmail;
            if (req.query.verificationStatus) query.verificationStatus = req.query.verificationStatus;
            if (req.query.from) query.from = { $regex: req.query.from, $options: 'i' };
            if (req.query.to) query.to = { $regex: req.query.to, $options: 'i' };
            if (req.query.type) query.transportType = req.query.type;
            if (req.query.status) query.status = req.query.status;
            if (req.query.minPrice || req.query.maxPrice) {
                query.price = {};
                if (req.query.minPrice) query.price.$gte = parseInt(req.query.minPrice);
                if (req.query.maxPrice) query.price.$lte = parseInt(req.query.maxPrice);
            }

            let sortObj = { createdAt: -1 };
            if (req.query.sort === 'price_asc') sortObj = { price: 1 };
            if (req.query.sort === 'price_desc') sortObj = { price: -1 };
            if (req.query.sort === 'rating') sortObj = { rating: -1 };
            if (req.query.sort === 'departure') sortObj = { departureTime: 1 };

            const page = parseInt(req.query.page) || 1;
            const perPage = parseInt(req.query.perPage) || 9;
            const skip = (page - 1) * perPage;

            const total = await ticketsCollection.countDocuments(query);
            const tickets = await ticketsCollection.find(query).sort(sortObj).skip(skip).limit(perPage).toArray();
            res.send({ total, tickets });
        });

        // GET single ticket
        app.get('/api/tickets/:id', async (req, res) => {
            const result = await ticketsCollection.findOne({ _id: new ObjectId(req.params.id) });
            res.send(result);
        });


        //User APIs
        /* Bookings APIs */
        // GET bookings
        app.get('/api/bookings', verifyToken, async (req, res) => {
            try {
                const query = {};
                if (req.query.userId) query.userId = req.query.userId;
                if (req.query.vendorEmail) query.vendorEmail = req.query.vendorEmail;
                if (req.query.status) query.status = req.query.status;

                const bookings = await bookingsCollection.find(query).sort({ createdAt: -1 }).toArray();
                res.send(bookings);
            } catch (err) {
                res.status(500).send({ message: err.message });
            }
        });

        // PATCH booking status
        app.patch('/api/bookings/:id', verifyToken, async (req, res) => {
            try {
                const { status } = req.body;
                const result = await bookingsCollection.updateOne(
                    { _id: new ObjectId(req.params.id) },
                    { $set: { status, updatedAt: new Date() } }
                );
                res.send(result);
            } catch (err) {
                res.status(500).send({ message: err.message });
            }
        });

        // DELETE booking (cancel)
        app.delete('/api/bookings/:id', verifyToken, async (req, res) => {
            try {
                const booking = await bookingsCollection.findOne({ _id: new ObjectId(req.params.id) });
                if (!booking) return res.status(404).send({ message: 'Booking not found' });
                if (booking.status !== 'pending') {
                    return res.status(400).send({ message: 'Cannot cancel after vendor has responded' });
                }
                const result = await bookingsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
                res.send(result);
            } catch (err) {
                res.status(500).send({ message: err.message });
            }
        });

        // POST booking with ticket availability check
        app.post('/api/bookings', verifyToken, async (req, res) => {
            try {
                const booking = req.body;

                // check ticket exists and has enough quantity
                const ticket = await ticketsCollection.findOne({ _id: new ObjectId(booking.ticketId) });
                if (!ticket) return res.status(404).send({ message: 'Ticket not found' });
                if (ticket.quantity < booking.quantity) {
                    return res.status(400).send({ message: 'Not enough seats available' });
                }

                const newBooking = {
                    ...booking,
                    status: 'pending',
                    createdAt: new Date()
                };

                const result = await bookingsCollection.insertOne(newBooking);
                res.send(result);
            } catch (err) {
                res.status(500).send({ message: err.message });
            }
        });





        //Vendor APIs
        // POST add ticket (vendor)
        app.post('/api/tickets', verifyToken, verifyVendor, async (req, res) => {
            try {
                const ticket = req.body;
                const newTicket = {
                    ...ticket,
                    vendorEmail: req.user.email,
                    vendorName: req.user.name,
                    verificationStatus: 'pending',
                    createdAt: new Date()
                };
                const result = await ticketsCollection.insertOne(newTicket);
                res.send(result);
            } catch (err) {
                res.status(500).send({ message: err.message });
            }
        });

        // PATCH update ticket (vendor)
        app.patch('/api/tickets/:id', verifyToken, async (req, res) => {
            try {
                const updatedData = req.body;
                const result = await ticketsCollection.updateOne(
                    { _id: new ObjectId(req.params.id) },
                    { $set: { ...updatedData, updatedAt: new Date() } }
                );
                res.send(result);
            } catch (err) {
                res.status(500).send({ message: err.message });
            }
        });

        // DELETE ticket (vendor)
        app.delete('/api/tickets/:id', verifyToken, async (req, res) => {
            try {
                const result = await ticketsCollection.deleteOne({
                    _id: new ObjectId(req.params.id),
                    vendorEmail: req.user.email
                });
                res.send(result);
            } catch (err) {
                res.status(500).send({ message: err.message });
            }
        });




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