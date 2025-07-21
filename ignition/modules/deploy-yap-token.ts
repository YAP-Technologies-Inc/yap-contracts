import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';
 
export default buildModule('SeiTokenModule', (m) => {
  const deployer = m.getAccount(0);

  const yapToken = m.contract('YapTokenTest', [deployer]);

  return { yapToken };
});