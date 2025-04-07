const express = require('express');
const cors = require('cors');
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
    pass: 'poxuomwnplynqopm'
  }
});

const planos = {
  normal: 'Instrucoes_Assistente_Financeiro.pdf',
  casal: 'instrucoes_assistente_financeiro_plano_casal.pdf',
  familia: 'instrucoes_assistente_financeiro_plano_familia.pdf'
};

function resolvePdfPath(pdfFileName) {
  const possiblePaths = [
    path.join(__dirname, 'pdfs', pdfFileName),
    path.join(__dirname, 'Pdfs', pdfFileName),
    path.join(process.cwd(), 'pdfs', pdfFileName),
    path.join(process.cwd(), 'Pdfs', pdfFileName)
  ];

  for (const pdfPath of possiblePaths) {
    if (fs.existsSync(pdfPath)) {
      return pdfPath;
    }
  }
  return null;
}
  }
  return null;
}

app.post('/webhook', async (req, res) => {
  try {
    if (!verifySignature(req, WEBHOOK_SECRET)) {
      return res.status(401).send('Assinatura inválida');
    }

    const event = req.body;
    console.log('Webhook recebido:', JSON.stringify(event, null, 2));

    if (event.type === 'payment' && event.data?.id) {
      const paymentId = event.data.id;
      const payment = await mercadopago.payment.get(paymentId);
      const paymentStatus = payment.body.status;

      if (paymentStatus === 'approved') {
        const payerEmail = payment.body.payer.email;
        const itemTitle = payment.body.additional_info.items[0].title;
        const plan = itemTitle.toLowerCase().includes('casal') ? 'casal' : itemTitle.toLowerCase().includes('familia') ? 'familia' : 'normal';

        const pdfFileName = planos[plan];
        const pdfPath = resolvePdfPath(pdfFileName);

        if (!pdfPath) {
          console.error('Arquivo PDF não encontrado:', pdfFileName);
          return res.status(404).send('Arquivo PDF não encontrado');
        }

        const mailOptions = {
          from: 'oficialfinanzap@gmail.com',
          to: payerEmail,
          subject: '📄 Seu Material do Finanzap',
          text: 'Obrigado por sua compra! Segue em anexo o material do seu plano.',
          attachments: [{
            filename: pdfFileName,
            path: pdfPath
          }]
        };

        transporter.sendMail(mailOptions, (error, info) => {
          if (error) {
            console.error('Erro ao enviar e-mail:', error.message);
          } else {
            console.log('E-mail enviado com sucesso:', info.response);
          }
        });
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Erro no webhook:', error.message);
    res.status(500).send('Erro interno');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
