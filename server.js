const express = require('express');
const cors = require('cors');
const axios = require('axios');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mercadopago = require('mercadopago');

const app = express();
app.use(cors());
app.use(express.json());

const ACCESS_TOKEN = 'APP_USR-2190858428063851-040509-f8899b0779b8753d85dae14f27892a0d-287816612';
const WEBHOOK_SECRET = '01d71aa758c6c87c2190438452b1dd6d52c06f2975fa56a221f6f324bbfa1482';
const WEBHOOK_URL = 'https://pix-backend-79lq.onrender.com/webhook';

mercadopago.configure({ access_token: ACCESS_TOKEN });

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'oficialfinanzap@gmail.com',
    pass: 'hrirzodqitdzwvrb'
  }
});

const planos = {
  normal: 'Instrucoes_Assistente_Financeiro.pdf',
  casal: 'instrucoes_assistente_financeiro_plano_casal.pdf',
  familia: 'instrucoes_assistente_financeiro_plano_familia.pdf'
};

function verifySignature(req, secret) {
  const signature = req.headers['x-mp-signature'] || '';
  const hash = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
  return signature === hash;
}

async function sendPdfByEmail(email, plano) {
  const filePath = path.join(__dirname, 'Pdfs', planos[plano]);
  const mailOptions = {
    from: 'oficialfinanzap@gmail.com',
    to: email,
    subject: 'Instruções de Uso - Assistente Financeiro',
    text: 'Obrigado pela sua compra! Segue em anexo o PDF com as instruções.',
    attachments: [
      { filename: planos[plano], path: filePath }
    ]
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`PDF enviado para ${email}`);
  } catch (error) {
    console.error(`Erro ao enviar PDF para ${email}:`, error.message);
  }
}

app.post('/webhook', (req, res) => {
  try {
    const event = req.body;
    console.log('Webhook recebido:', JSON.stringify(event, null, 2));

    if (event.type === 'payment' && event.data && event.data.id) {
      console.log('Pagamento recebido:', event.data.id);

      const paymentId = event.data.id;
      mercadopago.payment.get(paymentId)
        .then(async (response) => {
          const { status, payer } = response.body;
          if (status === 'approved') {
            const email = payer.email;
            const plano = 'normal'; // Substituir pela lógica correta para obter o plano
            await sendPdfByEmail(email, plano);
          }
        })
        .catch(error => console.error('Erro ao obter pagamento:', error.message));

      res.status(200).send({ status: 'sucesso', message: 'Pagamento recebido' });
    } else {
      console.log('Evento não tratado:', event.type);
      res.status(200).send({ status: 'sucesso', message: 'Evento recebido, mas não tratado' });
    }
  } catch (error) {
    console.error('Erro ao processar webhook:', error.message);
    res.status(500).send({ status: 'erro', message: 'Erro no processamento do webhook', detalhes: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
