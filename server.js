const express = require("express");
const fs = require("fs");
const app = express();
const path = require("path");
const MongoClient = require("mongodb").MongoClient;

const PORT = Number(process.env.PORT) || 5052;
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

function defaultMongoUrl() {
  // Inside a container, localhost is the container itself — reach host-published Mongo via Docker Desktop's hostname.
  const host = fs.existsSync("/.dockerenv") ? "host.docker.internal" : "localhost";
  return `mongodb://admin:qwerty@${host}:27018/?authSource=admin`;
}

const MONGO_URL = process.env.MONGO_URL || defaultMongoUrl();
const client = new MongoClient(MONGO_URL);

let db;

async function connectDB() {
  try {
    await client.connect();
    db = client.db("salah-db");
    console.log("Connected successfully to MongoDB");
  } catch (err) {
    console.error("MongoDB connection failed:", err.message);
    console.error(
      "With Compose, use the app service (MONGO_URL points at mongodb:27017). Plain docker run: start Mongo first (e.g. docker compose up -d mongodb). On Linux you may need: --add-host=host.docker.internal:host-gateway"
    );
    process.exit(1);
  }
}

//GET all users
// get(path, callback)
app.get("/getUsers", async (req, res) => {
  try {
    const data = await db.collection("users").find({}).toArray();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /addUser - redirect to home page with signup form
app.get("/addUser", (req, res) => {
  res.status(200).redirect("/"); // redirect to home page
});

//POST new user
app.post("/addUser", async (req, res) => {
  const userObj = req.body;
  console.log(req.body);
  try {
    const data = await db.collection("users").insertOne(userObj);
    // console.log(data);
    console.log("data inserted in DB");
    res
      .status(201 || 200)
      .json({
        insertedId: data.insertedId,
        message: "User added successfully",
      });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// connect to MongoDB and start the server
connectDB().then(() => {
  const server = app.listen(PORT, () => {
    console.log(`server running on port ${PORT}`);
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `Port ${PORT} is already in use. Stop the other process (e.g. lsof -iTCP:${PORT} -sTCP:LISTEN) or run PORT=5052 node server.js`
      );
    } else {
      console.error(err);
    }
    process.exit(1);
  });
});
