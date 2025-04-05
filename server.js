const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PORT = process.env.PORT || 3000;

app.post('/criar-pagamento', async (req, res) => {
  const idempotencyKey = uuidv4();

  try {
    const response = await axios.post(
      'https://api.mercadopago.com/v1/payments',
      {
        transaction_amount: 1,
        payment_method_id: 'pix',
        description: 'Pagamento com PIX',
        payer: {
          email: 'comprador@email.com',
          first_name: 'João',
          last_name: 'Silva',
          identification: {
            type: 'CPF',
            number: '12345678909'
          },
          address: {
            zip_code: '06233200',
            street_name: 'Av. das Nações Unidas',
            street_number: '3003',
            neighborhood: 'Bonfim',
            city: 'Osasco',
            federal_unit: 'SP'
          }
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey
        }
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(400).json(error.response?.data || { error: 'Erro ao criar pagamento' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});