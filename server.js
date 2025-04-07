// Importação de módulos necessários
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const mercadopago = require('mercadopago');

const app = express();
app.use(cors());
app.use(express.json());

// Configuração Mercado Pago
const ACCESS_TOKEN = 'SEU_ACCESS_TOKEN';
mercadopago.configure({ access_token: ACCESS_TOKEN });

// Configuração do Nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'oficialfinanzap@gmail.com',
    pass: 'hrirzodqitdzwvrb'
  }
});

// Função para obter o conteúdo do plano
function getPlanoContent(plano, email) {
  let title, content;

  switch (plano) {
    case 'normal':
      title = 'Plano Normal - Instruções para Utilização do Assistente Financeiro';
      content = `
        Para utilizar o nosso Assistente Financeiro, siga as instruções abaixo:

        1. Abra o WhatsApp.
        2. Envie uma mensagem para o seguinte número: 5524999667873
        3. Na mensagem, informe o número que deseja utilizar no assistente financeiro.
        4. A ativação será feita automaticamente para a utilização do assistente.

        Caso tenha dúvidas, entre em contato conosco.
      `;
      break;

    case 'casal':
      title = 'Plano Casal - Passo a Passo para Ativação do Assistente Financeiro';
      content = `
        (PLANO CASAL)

        • Salve o número 5524999267311 nos seus contatos.
        • Abra o WhatsApp e envie uma mensagem para o número salvo.
        3. Na mensagem, informe:
          - O número de telefone que deseja adicionar ao plano casal.
          - Envie o print (captura de tela) do comprovante de compra do plano.
        
        • A ativação será feita automaticamente, e você já poderá começar a usar o assistente.

        Dúvidas? Entre em contato conosco!
      `;
      break;

    case 'familia':
      title = 'Plano Família - Passo a Passo para Ativação do Assistente Financeiro';
      content = `
        (PLANO FAMILIA)

        • Salve o número 5524999267311 nos seus contatos.
        • Abra o WhatsApp e envie uma mensagem para o número salvo.
        3. Na mensagem, informe:
          - Os 2 números de telefone que deseja adicionar ao plano familiar.
          - Envie o print (captura de tela) do comprovante de compra do plano.
        
        • A ativação será feita automaticamente, e você já poderá começar a usar o assistente.

        Dúvidas? Entre em contato conosco!
      `;
      break;
  }

  return { title, content };
}

// Função para gerar o PDF
function generatePDF(plano, email) {
  return new Promise((resolve, reject) => {
    const { title, content } = getPlanoContent(plano, email);
    const doc = new PDFDocument();
    const fileName = `instrucoes_${plano}_${Date.now()}.pdf`;
    const filePath = path.join(__dirname, fileName);

    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    doc.fontSize(20).text(title, { align: 'center' });
    doc.moveDown();
    doc.fontSize(14).text(content, { align: 'left' });
    doc.end();

    writeStream.on('finish', () => resolve(filePath));
    writeStream.on('error', (err) => reject(err));
  });
}

// Webhook para processar o pagamento
app.post('/webhook', async (req, res) => {
  try {
    const event = req.body;

    if (event.type === 'payment' && event.data?.id) {
      const paymentId = event.data.id;
      const paymentInfo = await mercadopago.payment.get(paymentId);

      if (paymentInfo.body.status === 'approved') {
        const email = paymentInfo.body.payer.email;
        const plano = paymentInfo.body.additional_info.items[0].title
          .replace('Plano ', '').toLowerCase();

        try {
          const pdfPath = await generatePDF(plano, email);

          const mailOptions = {
            from: 'SEU_EMAIL@gmail.com',
            to: email,
            subject: `Seu PDF do Plano ${plano} está aqui! 🎉`,
            text: 'Obrigado por sua compra! Em anexo está o PDF com as instruções do seu plano.',
            attachments: [{ filename: path.basename(pdfPath), path: pdfPath }]
          };

          await transporter.sendMail(mailOptions);
          fs.unlinkSync(pdfPath);

          res.status(200).send({ status: 'sucesso', message: 'Pagamento confirmado e PDF enviado.' });
        } catch (error) {
          res.status(500).send({ status: 'erro', message: 'Erro ao gerar ou enviar o PDF', detalhes: error.message });
        }
      } else {
        res.status(200).send({ status: 'pendente', message: 'Pagamento recebido, porém não aprovado ainda.' });
      }
    } else {
      res.status(200).send({ status: 'sucesso', message: 'Evento não tratado recebido.' });
    }
  } catch (error) {
    res.status(500).send({ status: 'erro', message: 'Falha ao processar webhook', detalhes: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
