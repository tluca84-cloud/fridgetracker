exports.handler = async (event) => {
  const body = JSON.parse(event.body);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  return {
    statusCode: 200,
    body: JSON.stringify(data)
  };
};