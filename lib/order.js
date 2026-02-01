export default function handler(req, res) {
  const { order } = req.body;

  res.json({
    status: "Orden recibida",
    order
  });
}
