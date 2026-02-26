const express = require("express");
const app = express();
const path = require("path");
const MongoClient = require("mongodb").MongoClient;

const PORT = 5050;
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

const MONGO_URL =
  process.env.MONGO_URL ||
  "mongodb://admin:qwerty@localhost:27027/?authSource=admin";
const client = new MongoClient(MONGO_URL);

let db;

async function connectDB() {
  try {
    await client.connect();
    db = client.db("salah-db");
    console.log("Connected successfully to MongoDB");
  } catch (err) {
    console.error("MongoDB connection failed:", err.message);
    console.error("Make sure MongoDB is running on port 27027");
    process.exit(1);
  }
}

//GET all users
app.get("/getUsers", async (req, res) => {
  try {
    const data = await db.collection("users").find({}).toArray();
    res.send(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /addUser - redirect to home page with signup form
app.get("/addUser", (req, res) => {
  res.redirect("/");
});

//POST new user
app.post("/addUser", async (req, res) => {
  const userObj = req.body;
  console.log(req.body);
  try {
    const data = await db.collection("users").insertOne(userObj);
    console.log(data);
    console.log("data inserted in DB");
    res
      .status(201)
      .json({
        insertedId: data.insertedId,
        message: "User added successfully",
      });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`server running on port ${PORT}`);
  });
});
