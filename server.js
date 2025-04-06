const express = require('express');
const cors = require('cors');
const axios = require('axios');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const ACCESS_TOKEN = 'APP_USR-2190858428063851-040509-f8899b0779b8753d85dae14f27892a0d-287816612';
const WEBHOOK_SECRET = '01d71aa758c6c87c2190438452b1dd6d52c06f2975fa56a221f6f324bbfa1482';

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

function verifySignature(req, secret) {
  const signature = req.headers['x-mp-signature'] || '';
  const hash = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
  return signature === hash;
}

app.post('/webhook', (req, res) => {
  try {
    if (!verifySignature(req, WEBHOOK_SECRET)) {
      console.log('Assinatura inválida');
      return res.status(401).send('Invalid signature');
    }

    const event = req.body;

    console.log('Webhook recebido:', JSON.stringify(event, null, 2));

    // Verifica o tipo de evento e a ação
    if (event.type === 'payment') {
      if (event.action === 'payment.created') {
        console.log('Pagamento criado:', event.data.id);
      } else if (event.action === 'payment.updated') {
        console.log('Pagamento atualizado:', event.data.id);
      } else if (event.action === 'payment.success' || event.data.status === 'approved') {
        console.log('Pagamento aprovado:', event.data.id);
        // Aqui podemos buscar o pagamento e enviar o PDF
      } else {
        console.log('Evento de pagamento não tratado:', event.action);
      }
    } else {
      console.log('Evento não relacionado a pagamento:', event.type);
    }

    res.status(200).send('Webhook recebido');
  } catch (error) {
    console.error('Erro ao processar webhook:', error.message);
    res.status(500).send('Erro no processamento do webhook');
  }
});

app.post('/criar-pagamento', async (req, res) => {
  try {
    const { email, plano } = req.body;
    const idempotencyKey = uuidv4();

    const response = await axios.post('https://api.mercadopago.com/v1/payments', {
      transaction_amount: 1,
      description: "Finanzap",
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
    console.error('Erro ao criar pagamento:', error.response?.data || error.message);
    res.status(500).send("Erro ao criar pagamento");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
