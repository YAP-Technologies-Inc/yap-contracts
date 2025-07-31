// We "burn" tokens by transferring them to the dead address (0x000...dEaD) because not all ERC-20 tokens
// implement a dedicated burn function. This ensures compatibility with standard tokens while effectively
// removing the tokens from circulation.

export async function splitAndBurn(token, user, amount, treasuryAddress){
    const burnAmount = amount / 2;
    const treasuryAmount = amount - burnAmount;

    const burnTx = await token.connect(user).transfer(
        "0x000000000000000000000000000000000000dEaD",
        burnAmount
    );
    await burnTx.wait();

    const treasuryTx = await token.connect(user).transfer(
        treasuryAddress,
        treasuryAmount
    );
    await treasuryTx.wait();
}