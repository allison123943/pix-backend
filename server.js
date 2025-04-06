const express = require('express');
const cors = require('cors');
const axios = require('axios');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const ACCESS_TOKEN = 'APP_USR-2190858428063851-040509-f8899b0779b8753d85dae14f27892a0d-287816612';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'oficialfinanzap@gmail.com',
    pass: 'irordtnnykrddujv'
  }
});

const planos = {
  normal: 'Instrucoes_Assistente_Financeiro.pdf',
  casal: 'instrucoes_assistente_financeiro_plano casal.pdf',
  familia: 'instrucoes_assistente_financeiro_plano familia.pdf'
};

app.post('/criar-pagamento', async (req, res) => {
  try {
    const { email, plano } = req.body;
    const idempotencyKey = uuidv4();

    const response = await axios.post('https://api.mercadopago.com/v1/payments', {
      transaction_amount: 1,
      description: "Produto Exemplo",
      payment_method_id: "pix",
      payer: {
        email: email,
        first_name: "Cliente",
        last_name: "PIX",
        identification: {
          type: "CPF",
          number: "12345678909"
        }
      }
    }, {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': idempotencyKey
      }
    });

    const planoArquivo = planos[plano] || planos.normal;
    const pdfPath = path.join(__dirname, planoArquivo);

    await transporter.sendMail({
      from: '"Assistente Financeiro" <oficialfinanzap@gmail.com>',
      to: email,
      subject: `Instruções de Pagamento - Plano ${plano}`,
      text: 'Obrigado pelo pagamento. Seguem as instruções em anexo.',
      attachments: [
        {
          filename: planoArquivo,
          path: pdfPath
        }
      ]
    });

    res.json(response.data);
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).send("Erro ao criar pagamento");
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
