from flask import Flask, jsonify, render_template, request
import random
import time

app = Flask(__name__)

# In-memory state (no database)
sensor_data = {
    "temperature": 27.4,
    "humidity": 65.2,
    "soil_moisture": 48.0,
    "light_intensity": 720,
    "timestamp": time.time()
}

device_status = {
    "pump": False,
    "fan": False
}


# ── Frontend ──────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


# ── Sensor Data ───────────────────────────────────────────
@app.route("/api/sensor-data", methods=["GET"])
def get_sensor_data():
    """Frontend polls this to display live values."""
    return jsonify({
        "status": "ok",
        "data": sensor_data,
        "devices": device_status
    })


@app.route("/api/sensor-data", methods=["POST"])
def post_sensor_data():
    """ESP32 POSTs its readings here."""
    payload = request.get_json(force=True, silent=True) or {}
    if "temperature"    in payload: sensor_data["temperature"]    = float(payload["temperature"])
    if "humidity"       in payload: sensor_data["humidity"]       = float(payload["humidity"])
    if "soil_moisture"  in payload: sensor_data["soil_moisture"]  = float(payload["soil_moisture"])
    if "light_intensity"in payload: sensor_data["light_intensity"]= float(payload["light_intensity"])
    sensor_data["timestamp"] = time.time()
    return jsonify({"status": "ok", "message": "Sensor data updated"})


# ── Pump Control ──────────────────────────────────────────
@app.route("/api/pump/on", methods=["POST"])
def pump_on():
    device_status["pump"] = True
    return jsonify({"status": "ok", "pump": True,  "message": "Water pump turned ON"})

@app.route("/api/pump/off", methods=["POST"])
def pump_off():
    device_status["pump"] = False
    return jsonify({"status": "ok", "pump": False, "message": "Water pump turned OFF"})


# ── Fan Control ───────────────────────────────────────────
@app.route("/api/fan/on", methods=["POST"])
def fan_on():
    device_status["fan"] = True
    return jsonify({"status": "ok", "fan": True,  "message": "Cooling fan turned ON"})

@app.route("/api/fan/off", methods=["POST"])
def fan_off():
    device_status["fan"] = False
    return jsonify({"status": "ok", "fan": False, "message": "Cooling fan turned OFF"})


# ── Dev helper: simulate sensor drift ────────────────────
@app.route("/api/simulate", methods=["POST"])
def simulate():
    """Nudges sensor values slightly so the UI shows 'live' changes during demo."""
    sensor_data["temperature"]     = round(random.uniform(22, 38), 1)
    sensor_data["humidity"]        = round(random.uniform(40, 90), 1)
    sensor_data["soil_moisture"]   = round(random.uniform(20, 80), 1)
    sensor_data["light_intensity"] = round(random.uniform(200, 1200), 0)
    sensor_data["timestamp"]       = time.time()
    return jsonify({"status": "ok", "data": sensor_data})


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
