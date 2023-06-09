const express = require('express');
const app = express();
const cors = require('cors');
require('dotenv').config();
const stripe = require("stripe")(`${process.env.PAYMENT_SECRET_KEY}`)
const jwt = require('jsonwebtoken');
const port = process.env.PORT || 5000;

// middleware 
app.use(cors());
app.use(express.json());

// jwt middleware
const verifyJWT = (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401).send({ error: true, message: "Unauthorized access" })
    }
    // bearer token
    const token = authorization.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).send({ error: true, message: "unauthorized access" })
        }
        req.decoded = decoded;
        next();
    })

}

// database connect------------------------
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.zexvqii.mongodb.net/?retryWrites=true&w=majority`;

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

        const reviewsCollection = client.db("bistroDB").collection('menu');
        const userCollection = client.db("bistroDB").collection('user');
        const menuCollection = client.db("bistroDB").collection('menu');
        const cartCollection = client.db('bistroDB').collection('cart');
        const paymentCollection = client.db('bistroDB').collection('payment');


        // jwt token apis
        app.post('/jwt', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })
            res.send({ token })
        })

        // admin verify middleware
        // warning: use verifyJWT before using verifyAdmin
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email }
            const user = await userCollection.findOne(query);
            if (user?.role !== 'admin') {
                return res.status(403).send({ error: true, message: "forbidden message" })
            }
            next();
        }

        // 0. do not show the admin link
        // 1.use jwt token:verifyJWT
        // 2. use verifyAdmin

        // users related apis
        app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await userCollection.find().toArray();
            res.send(result);
        })

        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email: user.email }
            const existingUser = await userCollection.findOne(query);
            if (existingUser) {
                return res.send({ message: 'User Already Exists' })
            }
            const result = await userCollection.insertOne(user);
            res.send(result);
        });

        // admin users:verifyJWT
        // email same
        // check admin
        // security layer
        app.get('/users/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            if (req.decoded.email !== email) {
                return { admin: false }
            }
            const query = { email: email };
            const user = await userCollection.findOne(query);
            const result = { admin: user?.role === 'admin' }
            res.send(result);
        })

        app.patch('/users/admin/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    role: 'admin'
                },
            };
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send(result);

        });

        app.delete('/users/:id', async (req, res) => {
            const id = req.params.id;
            console.log(id);
            const query = { _id: new ObjectId(id) };
            const result = await userCollection.deleteOne(query);
            res.send(result);
        })

        // menu related apis
        app.get('/menu', async (req, res) => {
            const result = await menuCollection.find().toArray();
            res.send(result)
        })

        app.post('/menu', verifyJWT, verifyAdmin, async (req, res) => {
            const newItem = req.body;
            const result = await menuCollection.insertOne(newItem);
            res.send(result);
        })

        app.delete('/menu/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            console.log(id);
            const query = { _id: new ObjectId(id) }
            const result = await menuCollection.deleteOne(query);
            res.send(result);

        })

        // reviews related apis
        app.get('/reviews', async (req, res) => {
            const result = await reviewsCollection.find().toArray();
            res.send(result);
        })

        // carts collection apis
        app.get('/carts', verifyJWT, async (req, res) => {
            const email = req.query.email;
            if (!email) {
                res.send([]);
            }
            const decodedEmail = req.decoded.email;
            if (email !== decodedEmail) {
                return res.status(403).send({ error: true, message: "forbidden access" })
            }
            const query = { email: email };
            const result = await cartCollection.find(query).toArray();
            res.send(result);
        })


        app.post('/carts', async (req, res) => {
            const item = req.body;
            const result = await cartCollection.insertOne(item);
            res.send(result)
        })

        app.delete('/carts/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await cartCollection.deleteOne(query);
            res.send(result);

        })

        // payment related  apis
        app.post('/payments', verifyJWT, async (req, res) => {

            const payment = req.body;
            const insertResult = await paymentCollection.insertOne(payment);

            // for delete
            const query = { _id: { $in: payment.cartItems.map(id => new ObjectId(id)) } }
            const deleteResult = await cartCollection.deleteMany(query);
            res.send({ result: insertResult, deleteResult });

        })

        // create payment intent 
        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });

            res.send({
                clientSecret: paymentIntent.client_secret
            })
        })

        // for admin home all things count

        app.get('/admin-stats', verifyJWT, verifyAdmin, async (req, res) => {
            const users = await userCollection.estimatedDocumentCount();
            const products = await menuCollection.estimatedDocumentCount();
            const orders = await paymentCollection.estimatedDocumentCount();
            // best way to get sum of the price field is to use group of sum
            // const payments = await paymentCollection.aggregate([
            //     {
            //         $group:{
            //             _id: null,
            //             total:{$sum:'$price'}
            //         }
            //     }
            // ]).toArray();

            const payment = await paymentCollection.find().toArray();
            const revenue = payment.reduce((sum, payment) => sum + payment.price, 0)

            res.send({ users, products, orders, revenue })
        })

        // -----------------------second best solution----------------------------
        // 1.load all payments 
        // 2.forEach payment get the menu items array
        // 3.for each item in the  menuItems array get the menuItem from the menu collection
        // 4.put then in an array: allOrderedItems
        // 5.separate allOrderedItems by category using filter
        // 6.now get the quantity by using length :pizzas.length.
        // 7.for each category use reduce to get the total amount spent on this memory

        app.get('/order-stats', verifyJWT, verifyAdmin, async (req, res) => {
            const pipeline = [
                {
                    $lookup: {
                        from: 'menu',
                        localField: 'menuItems',
                        foreignField: '_id',
                        as: 'menuItemsData'
                    }
                },
                {
                    $unwind: '$menuItemsData'
                },
                {
                    $group: {
                        _id: '$menuItemsData.category',
                        count: { $sum: 1 },
                        total: { $sum: '$menuItemsData.price' }
                    }
                },
                {
                    $project: {
                        category: '$_id',
                        count: 1,
                        totalPrice: { $round: ['$total', 2] },
                        _id: 0

                    }
                }

            ];
            const result = await paymentCollection.aggregate(pipeline).toArray();
            res.send(result);



        })


        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('bistro-boss server is running')
})

app.listen(port, () => {
    console.log(`server is running on port ${port}`)
})



// -----------------------------------------------------------------------
//                         naming convention
// -----------------------------------------------------------------------
// users: userCollection
// app.get('/users')
// app.get('/user/:id')
// app.post('/users')
// app.patch('/users/:id')
// app.put('/users/:is')
// app.delete('/users/:id')
