const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { Resend } = require("resend");
const pool = require("./db");

console.log("Loaded DATABASE_URL:", process.env.DATABASE_URL);

const app = express();
const resend = new Resend(process.env.RESEND_API_KEY);

const allowedOrigins = [
  "https://www.gulfcoasteventhub.com",
  "https://gulfcoasteventhub.com",
  "https://gulf-coast-event-hub.vercel.app",
];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Not allowed by CORS: ${origin}`));
    },
    credentials: true,
  })
);

app.use(express.json());

app.options(
  "*",
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Not allowed by CORS: ${origin}`));
    },
    credentials: true,
  })
);

pool
  .query("SELECT NOW()")
  .then((result) => {
    console.log("Database connected:", result.rows[0]);
  })
  .catch((err) => {
    console.error("Database connection test failed:", err);
  });

app.get("/", (req, res) => {
  res.json({ ok: true, message: "Gulf Coast Event Hub backend is running." });
});

app.get("/api/event-requests", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM event_requests
      ORDER BY created_at DESC
    `);

    return res.status(200).json({
      ok: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("GET event requests error:", error);
    return res.status(500).json({
      ok: false,
      message: "Failed to fetch event requests.",
    });
  }
});

app.get("/api/request-vendors", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM request_vendors
      ORDER BY created_at ASC
    `);

    return res.status(200).json({
      ok: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("GET request-vendors error:", error);
    return res.status(500).json({
      ok: false,
      message: "Failed to fetch vendor assignments.",
      error: error.message,
    });
  }
});

app.post("/api/request-vendors", async (req, res) => {
  try {
    const {
      eventRequestId,
      serviceType,
      vendorName,
      vendorCost,
      customerPrice,
      status,
      notes,
    } = req.body;

    if (!eventRequestId || !serviceType) {
      return res.status(400).json({
        ok: false,
        message: "eventRequestId and serviceType are required.",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO request_vendors
      (event_request_id, service_type, vendor_name, vendor_cost, customer_price, status, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
      `,
      [
        eventRequestId,
        serviceType,
        vendorName || null,
        vendorCost || null,
        customerPrice || null,
        status || "pending",
        notes || null,
      ]
    );

    return res.status(201).json({
      ok: true,
      message: "Vendor assignment created.",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("POST request-vendors error:", error);
    return res.status(500).json({
      ok: false,
      message: "Failed to create vendor assignment.",
      error: error.message,
    });
  }
});

app.get("/api/request-vendors/:eventRequestId", async (req, res) => {
  try {
    const { eventRequestId } = req.params;

    const result = await pool.query(
      `
      SELECT *
      FROM request_vendors
      WHERE event_request_id = $1
      ORDER BY created_at ASC;
      `,
      [eventRequestId]
    );

    return res.status(200).json({
      ok: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("GET request-vendors error:", error);
    return res.status(500).json({
      ok: false,
      message: "Failed to fetch vendor assignments.",
      error: error.message,
    });
  }
});

app.post("/api/event-requests", async (req, res) => {
  try {
    console.log("GC BACKEND - REQUEST HIT", req.body);

    const {
      name,
      email,
      phone,
      eventDate,
      eventType,
      services,
      details,
    } = req.body;

    if (!name || !email || !phone || !eventDate || !eventType) {
      return res.status(400).json({
        ok: false,
        message: "Missing required fields.",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO event_requests
      (name, email, phone, event_date, event_type, services, details)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
      `,
      [
        name,
        email,
        phone,
        eventDate,
        eventType,
        JSON.stringify(services),
        details,
      ]
    );

    const savedRequest = result.rows[0];
    console.log("GC BACKEND - INSERTED ROW", savedRequest);

    const servicesList = Array.isArray(savedRequest.services)
      ? savedRequest.services.join(", ")
      : savedRequest.services;

    try {
      const emailResult = await resend.emails.send({
        from: process.env.FROM_EMAIL,
        to: process.env.NOTIFY_EMAIL,
        subject: `New Event Request from ${savedRequest.name}`,
        html: `
          <h2>New Event Request</h2>
          <p><strong>Name:</strong> ${savedRequest.name}</p>
          <p><strong>Email:</strong> ${savedRequest.email}</p>
          <p><strong>Phone:</strong> ${savedRequest.phone}</p>
          <p><strong>Event Date:</strong> ${savedRequest.event_date}</p>
          <p><strong>Event Type:</strong> ${savedRequest.event_type}</p>
          <p><strong>Services:</strong> ${servicesList || "None selected"}</p>
          <p><strong>Details:</strong> ${savedRequest.details || "None provided"}</p>
          <hr />
          <p><strong>Request ID:</strong> ${savedRequest.id}</p>
        `,
      });

      console.log("EMAIL SENT:", emailResult);
    } catch (emailError) {
      console.error("EMAIL SEND FAILED:", emailError);
    }

    return res.status(201).json({
      ok: true,
      message: "Saved to database",
      data: savedRequest,
    });
  } catch (error) {
    console.error("DB error:", error);
    return res.status(500).json({
      ok: false,
      message: "Server error",
      error: error.message,
    });
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});